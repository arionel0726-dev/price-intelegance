import { Injectable } from '@nestjs/common';

import {
  competitorProductVariants,
  competitorProducts,
  competitors,
  eq,
  matches,
  products,
} from '@price/db';

import { DatabaseService } from '../database/database.service';
import { scoreCandidate } from './candidate-scoring';
import { canonicalBrand } from './matching-normalization';
import type {
  CandidateEvaluation,
  CompetitorVariantRow,
  MatchGroupResult,
  PersistAutoOptions,
  PersistAutoResult,
  PreviewResult,
  VizajeCandidate,
} from './matching.types';

// The only competitors that should ever be auto-matched. Demo/seed
// competitors (Brocard, Aroma) stay in the DB for the existing frontend but
// must never be targeted by the deterministic matcher.
const REAL_COMPETITOR_DOMAINS = ['makeup.md', 'ovico.md'];

// Margin (in score points) required to replace an already-persisted AUTO
// match with a different variant - see persistAuto(). Unrelated to single-
// candidate scoring (candidate-scoring.ts), so it stays here.
const AUTO_MARGIN_MIN_POINTS = 8;

@Injectable()
export class MatchingService {
  constructor(private readonly database: DatabaseService) {}

  async preview(options?: { competitorDomains?: string[] }): Promise<PreviewResult> {
    const computed = await this.computeGroups(options?.competitorDomains);

    const auto = computed.groups.filter(g => g.decision === 'auto');
    const ambiguous = computed.groups.filter(g => g.decision === 'ambiguous');
    const noMatch = computed.groups.filter(g => g.decision === 'no_candidate');

    return {
      summary: {
        vizajeProductsScanned: computed.vizajeProductsScanned,
        competitorParentsScanned: computed.competitorParentsScanned,
        candidatePairsEvaluated: computed.candidatePairsEvaluated,
        autoCount: auto.length,
        ambiguousCount: ambiguous.length,
        noMatchCount: noMatch.length,
      },
      auto,
      ambiguous,
    };
  }

  // Dry-run/preview and persist-auto share the exact same evaluation - this
  // guarantees "what you saw in preview is what gets persisted" with no
  // separate code path that could silently diverge.
  private async computeGroups(competitorDomains?: string[]): Promise<{
    groups: MatchGroupResult[];
    vizajeProductsScanned: number;
    competitorParentsScanned: number;
    competitorsScanned: number;
    candidatePairsEvaluated: number;
  }> {
    const vizajeProducts = await this.loadVizajeCandidates();
    let variantRows = await this.loadCompetitorVariants();

    if (competitorDomains && competitorDomains.length > 0) {
      const allowed = new Set(competitorDomains);
      variantRows = variantRows.filter(row => allowed.has(row.competitorDomain));
    }

    const vizajeByBrand = new Map<string, VizajeCandidate[]>();
    for (const product of vizajeProducts) {
      const key = canonicalBrand(product.brand);
      if (!key) continue;

      const list = vizajeByBrand.get(key);
      if (list) list.push(product);
      else vizajeByBrand.set(key, [product]);
    }

    const evaluations: CandidateEvaluation[] = [];
    const competitorParentsScanned = new Set<number>();
    const competitorsScanned = new Set<number>();

    for (const row of variantRows) {
      competitorParentsScanned.add(row.productId);
      competitorsScanned.add(row.competitorId);

      const brandKey = canonicalBrand(row.productBrand);
      if (!brandKey) continue;

      const candidates = vizajeByBrand.get(brandKey);
      if (!candidates || candidates.length === 0) continue;

      for (const vizaje of candidates) {
        evaluations.push(this.evaluateCandidate(vizaje, row));
      }
    }

    const groups = this.groupAndDecide(evaluations);

    return {
      groups,
      vizajeProductsScanned: vizajeProducts.length,
      competitorParentsScanned: competitorParentsScanned.size,
      competitorsScanned: competitorsScanned.size,
      candidatePairsEvaluated: evaluations.length,
    };
  }

  // ---------------------------------------------------------------------
  // Persistence - writes ONLY groups already classified as 'auto'.
  // ---------------------------------------------------------------------

  async persistAuto(options?: PersistAutoOptions): Promise<PersistAutoResult> {
    const computed = await this.computeGroups(REAL_COMPETITOR_DOMAINS);

    let autoGroups = computed.groups.filter(g => g.decision === 'auto');

    if (options?.competitor) {
      const wanted = options.competitor.toUpperCase();
      autoGroups = autoGroups.filter(g => g.competitorName.toUpperCase() === wanted);
    }

    const existingByKey = await this.loadExistingMatchesByProductCompetitor();

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let conflicts = 0;
    let skippedManual = 0;

    for (const group of autoGroups) {
      const candidate = group.top!;
      const key = `${group.vizajeProductId}:${group.competitorId}`;
      const existing = existingByKey.get(key);

      const outcome = await this.applyAutoMatch(
        group.vizajeProductId,
        candidate.variantId,
        candidate.score,
        existing,
      );

      if (outcome === 'inserted') inserted += 1;
      else if (outcome === 'updated') updated += 1;
      else if (outcome === 'unchanged') unchanged += 1;
      else if (outcome === 'conflict') conflicts += 1;
      else skippedManual += 1;
    }

    return {
      evaluatedCompetitors: computed.competitorsScanned,
      autoCandidates: autoGroups.length,
      inserted,
      updated,
      unchanged,
      conflicts,
      skippedManual,
    };
  }

  // Single-pair match-persistence decision, shared by the bulk persistAuto()
  // loop above and persistSingleAutoMatch() below (used by targeted-search
  // sync, which scores and persists ONE Vizaje/competitor pair at a time
  // instead of recomputing the whole catalog). The rules themselves -
  // manual always wins, same-variant score refresh, replace-only-if-margin-
  // clears - are unchanged; this only makes them callable from one place.
  private async applyAutoMatch(
    vizajeProductId: number,
    variantId: number,
    score: number,
    existing:
      | { matchId: number; variantId: number; source: string; score: number | null }
      | undefined,
  ): Promise<'inserted' | 'updated' | 'unchanged' | 'conflict' | 'skippedManual'> {
    if (!existing) {
      await this.database.db
        .insert(matches)
        .values({
          productId: vizajeProductId,
          competitorProductVariantId: variantId,
          source: 'auto',
          score,
        })
        .onConflictDoUpdate({
          target: [matches.productId, matches.competitorProductVariantId],
          set: { score, source: 'auto' },
        });

      return 'inserted';
    }

    // Manual (or any future non-auto source) always wins - never touched by
    // the automatic sync, regardless of variant agreement.
    if (existing.source !== 'auto') {
      return 'skippedManual';
    }

    if (existing.variantId === variantId) {
      if (existing.score !== score) {
        await this.database.db
          .update(matches)
          .set({ score })
          .where(eq(matches.id, existing.matchId));

        return 'updated';
      }

      return 'unchanged';
    }

    // A different variant is currently matched for this Vizaje product +
    // competitor. Replace only if clearly better (same margin bar used for
    // the tie-break rule); otherwise leave the existing match alone rather
    // than oscillate between near-equal candidates.
    const existingScore = existing.score ?? 0;

    if (score - existingScore >= AUTO_MARGIN_MIN_POINTS) {
      await this.database.db
        .update(matches)
        .set({ competitorProductVariantId: variantId, score, source: 'auto' })
        .where(eq(matches.id, existing.matchId));

      return 'updated';
    }

    return 'conflict';
  }

  // Persists exactly one Vizaje product <-> competitor match, using the
  // exact same rules as persistAuto() (see applyAutoMatch above), without
  // recomputing/rescoring the rest of the catalog. Used by targeted-search
  // sync: score a single freshly-parsed candidate, decide AUTO, then persist
  // just that one pair.
  async persistSingleAutoMatch(
    vizajeProductId: number,
    competitorId: number,
    variantId: number,
    score: number,
  ): Promise<{
    outcome: 'inserted' | 'updated' | 'unchanged' | 'conflict' | 'skippedManual';
  }> {
    const existingByKey = await this.loadExistingMatchesByProductCompetitor();
    const existing = existingByKey.get(`${vizajeProductId}:${competitorId}`);

    const outcome = await this.applyAutoMatch(vizajeProductId, variantId, score, existing);

    return { outcome };
  }

  private async loadExistingMatchesByProductCompetitor(): Promise<
    Map<string, { matchId: number; variantId: number; source: string; score: number | null }>
  > {
    const rows = await this.database.db
      .select({
        matchId: matches.id,
        productId: matches.productId,
        variantId: matches.competitorProductVariantId,
        source: matches.source,
        score: matches.score,
        competitorId: competitors.id,
      })
      .from(matches)
      .innerJoin(
        competitorProductVariants,
        eq(matches.competitorProductVariantId, competitorProductVariants.id),
      )
      .innerJoin(
        competitorProducts,
        eq(competitorProductVariants.competitorProductId, competitorProducts.id),
      )
      .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id));

    const byKey = new Map<
      string,
      { matchId: number; variantId: number; source: string; score: number | null }
    >();

    for (const row of rows) {
      byKey.set(`${row.productId}:${row.competitorId}`, {
        matchId: row.matchId,
        variantId: row.variantId,
        source: row.source,
        score: row.score,
      });
    }

    return byKey;
  }

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------

  private async loadVizajeCandidates(): Promise<VizajeCandidate[]> {
    const rows = await this.database.db
      .select({
        id: products.id,
        brand: products.brand,
        name: products.name,
        volume: products.volume,
        color: products.color,
      })
      .from(products);

    return rows;
  }

  private async loadCompetitorVariants(): Promise<CompetitorVariantRow[]> {
    const rows = await this.database.db
      .select({
        variantId: competitorProductVariants.id,
        variantExternalId: competitorProductVariants.externalId,
        label: competitorProductVariants.label,
        volume: competitorProductVariants.volume,
        price: competitorProductVariants.price,

        productId: competitorProducts.id,
        productExternalId: competitorProducts.externalId,
        productBrand: competitorProducts.brand,
        productTitle: competitorProducts.title,

        competitorId: competitors.id,
        competitorName: competitors.name,
        competitorDomain: competitors.domain,
      })
      .from(competitorProductVariants)
      .innerJoin(
        competitorProducts,
        eq(competitorProductVariants.competitorProductId, competitorProducts.id),
      )
      .innerJoin(competitors, eq(competitorProducts.competitorId, competitors.id));

    return rows;
  }

  // ---------------------------------------------------------------------
  // Per-candidate evaluation (brand gate already passed by construction)
  // ---------------------------------------------------------------------

  private evaluateCandidate(
    vizaje: VizajeCandidate,
    row: CompetitorVariantRow,
  ): CandidateEvaluation {
    const result = scoreCandidate(
      { brand: vizaje.brand, name: vizaje.name, volume: vizaje.volume, color: vizaje.color },
      { title: row.productTitle, variantLabel: row.label, variantVolume: row.volume },
    );

    return {
      vizajeProductId: vizaje.id,
      vizajeBrand: vizaje.brand,
      vizajeName: vizaje.name,
      vizajeVolume: vizaje.volume,
      vizajeColor: vizaje.color,
      competitorId: row.competitorId,
      competitorName: row.competitorName,
      productId: row.productId,
      productExternalId: row.productExternalId,
      productTitle: row.productTitle,
      variantId: row.variantId,
      variantExternalId: row.variantExternalId,
      variantLabel: row.label,
      variantVolume: row.volume,
      nameSimilarity: result.nameSimilarity,
      score: result.score,
      decision: result.decision,
      rejectReason: result.rejectReason,
      signals: result.signals,
    };
  }

  // ---------------------------------------------------------------------
  // Grouping + tie/margin rule
  // ---------------------------------------------------------------------

  private groupAndDecide(evaluations: CandidateEvaluation[]): MatchGroupResult[] {
    const groups = new Map<string, CandidateEvaluation[]>();

    for (const evaluation of evaluations) {
      if (evaluation.decision === 'reject') continue;

      const key = `${evaluation.vizajeProductId}:${evaluation.competitorId}`;
      const list = groups.get(key);
      if (list) list.push(evaluation);
      else groups.set(key, [evaluation]);
    }

    const results: MatchGroupResult[] = [];

    for (const list of groups.values()) {
      list.sort((a, b) => b.score - a.score);

      const top = list[0]!;
      const second = list[1] ?? null;
      const margin = second ? top.score - second.score : null;

      let decision: MatchGroupResult['decision'];

      if (top.decision === 'auto') {
        decision =
          second === null || margin! >= AUTO_MARGIN_MIN_POINTS
            ? 'auto'
            : 'ambiguous';
      } else {
        decision = 'ambiguous';
      }

      results.push({
        vizajeProductId: top.vizajeProductId,
        competitorId: top.competitorId,
        competitorName: top.competitorName,
        decision,
        top,
        secondBest: second,
        margin,
      });
    }

    return results;
  }
}
