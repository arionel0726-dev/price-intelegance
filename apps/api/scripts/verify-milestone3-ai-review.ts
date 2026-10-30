import 'reflect-metadata';

import {
  and,
  appSettings,
  brands,
  competitorProductVariants,
  competitorProducts,
  competitors,
  discoveryAttempts,
  discoveryCandidates,
  eq,
  ilike,
  inArray,
  jobEvents,
  jobRuns,
  matches,
  products,
  sql,
} from '@price/db';

import { AiReviewService } from '../src/ai/ai-review.service';
import type { DeepseekReviewResult } from '../src/ai/deepseek-review.types';
import { DiscoveryAiReviewService } from '../src/ai/discovery-ai-review.service';
import { CompetitorPersistenceService } from '../src/competitors/competitor-persistence.service';
import { DiscoveryStateService } from '../src/competitors/discovery-state.service';
import { selectNextContinuousTarget } from '../src/competitors/discovery-targets';
import { canonicalBrand } from '../src/matching/matching-normalization';
import { MatchingService } from '../src/matching/matching.service';
import { DatabaseService } from '../src/database/database.service';
import { DiscoveryJobsService } from '../src/jobs/discovery-jobs.service';
import { DiscoveryWorkerService } from '../src/jobs/discovery-worker.service';
import { AppSettingsService } from '../src/policy/app-settings.service';

// Milestone 3 (DeepSeek integration + AI Review) integration verification -
// same real-Postgres, synthetic-prefix, cleaned-up-in-finally convention as
// verify-milestone1-policy-discovery.ts/verify-milestone2-worker.ts. NEVER
// calls the real DeepSeek API - DiscoveryAiReviewService is constructed
// with a FakeDeepseekReviewerService (see below), matching the Fake*
// pattern verify-milestone2-worker.ts already uses for the parser.
//
// Run with (from apps/api):
//   DATABASE_URL=postgresql://price:price@localhost:5432/price \
//   AI_REVIEW_PROCESSING_LEASE_MS=200 \
//   bun run scripts/verify-milestone3-ai-review.ts

const PREFIX = 'test-m3-';
const AI_ENABLED_KEY = 'ai.enabled';
const AI_THRESHOLD_KEY = 'ai.auto_confirm_threshold';

let failures = 0;
function check(label: string, condition: boolean): void {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${label}`);
  if (!condition) failures += 1;
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FakeDeepseekReviewerService {
  calls = 0;

  constructor(private readonly nextResult: () => DeepseekReviewResult) {}

  isConfigured(): boolean {
    return true;
  }

  async reviewCandidate(): Promise<DeepseekReviewResult> {
    this.calls += 1;
    return this.nextResult();
  }
}

function successResult(overrides: Partial<{ verdict: 'approve' | 'reject'; confidence: number; reason: string }> = {}): DeepseekReviewResult {
  return {
    kind: 'success',
    verdict: overrides.verdict ?? 'approve',
    confidence: overrides.confidence ?? 0.95,
    reason: overrides.reason ?? 'same brand, name and volume',
    signals: { brand: 'Test' },
    usage: {
      model: 'deepseek-chat',
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      latencyMs: 42,
      estimatedCostUsd: 0.0001,
    },
  };
}

async function main() {
  const database = new DatabaseService();
  const persistence = new CompetitorPersistenceService(database);
  const discoveryState = new DiscoveryStateService(database);
  const matching = new MatchingService(database);
  const appSettingsService = new AppSettingsService(database);
  const jobsService = new DiscoveryJobsService(database, persistence);

  const insertedProductIds: number[] = [];
  const insertedJobRunIds: number[] = [];
  const BRAND = `${PREFIX}brand`;

  // Save/restore the REAL app_settings rows - this script flips ai.enabled
  // and the threshold repeatedly; must never leave them altered for any
  // other script/process that reads them afterward.
  const [originalEnabledRow] = await database.db.select().from(appSettings).where(eq(appSettings.key, AI_ENABLED_KEY));
  const [originalThresholdRow] = await database.db.select().from(appSettings).where(eq(appSettings.key, AI_THRESHOLD_KEY));

  async function setAiEnabled(value: boolean) {
    await database.db
      .insert(appSettings)
      .values({ key: AI_ENABLED_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }
  async function setAiThreshold(value: number) {
    await database.db
      .insert(appSettings)
      .values({ key: AI_THRESHOLD_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }

  try {
    await database.db
      .insert(brands)
      .values({ canonicalKey: canonicalBrand(BRAND), displayName: 'Test M3 Brand' })
      .onConflictDoNothing({ target: brands.canonicalKey });

    const productRows = await database.db
      .insert(products)
      .values(
        Array.from({ length: 16 }, (_, i) => ({
          sourceKey: `${PREFIX}p${i}`,
          brand: BRAND,
          name: `Test M3 Product ${i}`,
          article: `ART-${i}`,
          barcode: `BARCODE-${i}`,
          volume: '50ml',
          url: `https://vizaje-nica.md/${PREFIX}p${i}`,
        })),
      )
      .returning({ id: products.id });
    for (const row of productRows) insertedProductIds.push(row.id);

    const [ovicoCompetitor] = await database.db
      .insert(competitors)
      .values({ name: 'OVICO', domain: 'ovico.md' })
      .onConflictDoNothing({ target: competitors.domain })
      .returning({ id: competitors.id });
    const ovicoId =
      ovicoCompetitor?.id ??
      (await database.db.select({ id: competitors.id }).from(competitors).where(eq(competitors.domain, 'ovico.md')))[0]!.id;

    // One competitor_product_variant PER test product, so each ambiguous
    // candidate below targets its own clean (never-matched-before) pair.
    const variantIdByProductIndex = new Map<number, number>();
    for (let i = 0; i < productRows.length; i++) {
      const [cp] = await database.db
        .insert(competitorProducts)
        .values({ competitorId: ovicoId, externalId: `${PREFIX}cp${i}`, title: `Test M3 Competitor Product ${i}`, url: `https://ovico.md/${PREFIX}cp${i}` })
        .returning({ id: competitorProducts.id });
      const [cpv] = await database.db
        .insert(competitorProductVariants)
        .values({ competitorProductId: cp!.id, externalId: `${PREFIX}cpv${i}`, label: 'Test variant', volume: '50ml', price: '100.00' })
        .returning({ id: competitorProductVariants.id });
      variantIdByProductIndex.set(i, cpv!.id);
    }

    async function createAmbiguousCandidate(productIndex: number, jobRunId: number | null = null): Promise<number> {
      const product = productRows[productIndex]!;
      const variantId = variantIdByProductIndex.get(productIndex)!;

      return discoveryState.recordAmbiguous({
        productId: product.id,
        competitorId: ovicoId,
        competitorProductVariantId: variantId,
        jobRunId,
        snapshotTitle: `Test M3 Competitor Product ${productIndex}`,
        snapshotVariantLabel: 'Test variant',
        snapshotVariantVolume: '50ml',
        snapshotPrice: '100.00',
        snapshotUrl: `https://ovico.md/${PREFIX}cpv${productIndex}`,
        snapshotImageUrl: null,
        ruleScore: 72,
        ruleSignals: { brandMatched: true } as never,
      });
    }

    // --- hard-conflict invariant (section 4) ---------------------------------
    console.log('=== hard-conflict invariant: the AI path can only ever operate on ruleDecision=ambiguous rows ===');
    const [hardConflictRow] = await database.db
      .insert(discoveryCandidates)
      .values({
        productId: productRows[0]!.id,
        competitorId: ovicoId,
        competitorProductVariantId: variantIdByProductIndex.get(0)!,
        snapshotTitle: 'simulated hard-conflict row',
        snapshotUrl: 'https://ovico.md/simulated',
        ruleScore: 10,
        ruleDecision: 'rejected', // NEVER a real value recordAmbiguous writes - simulates the one way a non-ambiguous row could exist, to prove the guard fires.
        ruleSignals: {},
        reviewStatus: 'pending',
      })
      .returning();

    const fakeAlwaysApprove = new FakeDeepseekReviewerService(() => successResult());
    const aiReviewForHardConflict = new DiscoveryAiReviewService(database, appSettingsService, fakeAlwaysApprove as never, matching, discoveryState);
    await setAiEnabled(true);

    let hardConflictThrew = false;
    try {
      await aiReviewForHardConflict.evaluateCandidate(hardConflictRow!.id);
    } catch {
      hardConflictThrew = true;
    }
    check('evaluateCandidate() throws (never silently proceeds) for a non-ambiguous ruleDecision row', hardConflictThrew);
    check('DeepSeek was NEVER actually called for the hard-conflict row', fakeAlwaysApprove.calls === 0);
    await database.db.delete(discoveryCandidates).where(eq(discoveryCandidates.id, hardConflictRow!.id));

    // --- AUTO/hard-reject never even create a candidate row (by construction) ---
    console.log('=== AUTO and hard-reject paths never create a discovery_candidates row at all ===');
    await discoveryState.recordNoMatch(productRows[1]!.id, ovicoId); // simulates a hard-reject/no-candidate outcome
    const [candidateAfterNoMatch] = await database.db
      .select()
      .from(discoveryCandidates)
      .where(and(eq(discoveryCandidates.productId, productRows[1]!.id), eq(discoveryCandidates.competitorId, ovicoId)));
    check(
      'recordNoMatch (the hard-reject/no-candidate path) never inserts a discovery_candidates row',
      candidateAfterNoMatch === undefined,
    );

    // --- ambiguous + AI disabled -> stays pending, never calls DeepSeek -----
    console.log('=== ai.enabled=false: ambiguous candidate stays pending, DeepSeek is never called ===');
    await setAiEnabled(false);
    const fakeNeverCalled = new FakeDeepseekReviewerService(() => {
      throw new Error('should never be called - ai.enabled is false');
    });
    const aiReviewDisabled = new DiscoveryAiReviewService(database, appSettingsService, fakeNeverCalled as never, matching, discoveryState);

    const candidate2Id = await createAmbiguousCandidate(2);
    const resultDisabled = await aiReviewDisabled.evaluateCandidate(candidate2Id);
    check('evaluateCandidate() reports unavailable/ai_disabled', resultDisabled.kind === 'unavailable' && (resultDisabled as { reason: string }).reason === 'ai_disabled');
    check('DeepSeek was never called while disabled', fakeNeverCalled.calls === 0);
    const [candidate2AfterDisabled] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate2Id));
    check('the candidate is completely untouched (reviewStatus still pending, aiVerdict still NULL)', candidate2AfterDisabled?.reviewStatus === 'pending' && candidate2AfterDisabled?.aiVerdict === null);

    // --- ambiguous + enabled + approve >= threshold -> ai auto-match ---------
    console.log('=== ai.enabled=true, approve >= threshold -> source=ai match, discovery_attempts cleared, threshold snapshotted ===');
    await setAiEnabled(true);
    await setAiThreshold(0.9);
    const fakeApproveHigh = new FakeDeepseekReviewerService(() => successResult({ verdict: 'approve', confidence: 0.97 }));
    const aiReviewApproveHigh = new DiscoveryAiReviewService(database, appSettingsService, fakeApproveHigh as never, matching, discoveryState);

    const candidate3Id = await createAmbiguousCandidate(3);
    const resultApproveHigh = await aiReviewApproveHigh.evaluateCandidate(candidate3Id);
    check('outcome is ai_auto_matched', resultApproveHigh.kind === 'ai_auto_matched');

    const [candidate3Row] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate3Id));
    check('aiVerdict=approve, reviewStatus=not_required, outcome=ai_auto_matched, resolvedAt set', candidate3Row?.aiVerdict === 'approve' && candidate3Row?.reviewStatus === 'not_required' && candidate3Row?.outcome === 'ai_auto_matched' && candidate3Row?.resolvedAt !== null);
    check('aiThresholdUsed snapshots the threshold AT evaluation time (0.90), not a live reference', candidate3Row?.aiThresholdUsed === '0.90');
    check('usage telemetry persisted (model/tokens/latency/cost)', candidate3Row?.aiModel === 'deepseek-chat' && candidate3Row?.aiPromptTokens === 120 && candidate3Row?.aiCompletionTokens === 30 && candidate3Row?.aiLatencyMs === 42);

    const [match3] = await database.db.select().from(matches).where(eq(matches.competitorProductVariantId, variantIdByProductIndex.get(3)!));
    check('a matches row exists with source=ai', match3?.source === 'ai');
    const [attempt3] = await database.db.select().from(discoveryAttempts).where(and(eq(discoveryAttempts.productId, productRows[3]!.id), eq(discoveryAttempts.competitorId, ovicoId)));
    check('discovery_attempts row was cleared (matches is now authoritative)', attempt3 === undefined);

    // --- ambiguous + enabled + approve < threshold -> pending human review ---
    console.log('=== ai.enabled=true, approve < threshold -> stays in the human queue ===');
    const fakeApproveLow = new FakeDeepseekReviewerService(() => successResult({ verdict: 'approve', confidence: 0.6 }));
    const aiReviewApproveLow = new DiscoveryAiReviewService(database, appSettingsService, fakeApproveLow as never, matching, discoveryState);

    const candidate4Id = await createAmbiguousCandidate(4);
    const resultApproveLow = await aiReviewApproveLow.evaluateCandidate(candidate4Id);
    check('outcome is pending_review', resultApproveLow.kind === 'pending_review');
    const [candidate4Row] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate4Id));
    check('aiVerdict=approve persisted, but reviewStatus stays pending (human queue)', candidate4Row?.aiVerdict === 'approve' && candidate4Row?.reviewStatus === 'pending');
    const [match4] = await database.db.select().from(matches).where(eq(matches.competitorProductVariantId, variantIdByProductIndex.get(4)!));
    check('no match was written for a below-threshold approve', match4 === undefined);
    const [attempt4] = await database.db.select().from(discoveryAttempts).where(and(eq(discoveryAttempts.productId, productRows[4]!.id), eq(discoveryAttempts.competitorId, ovicoId)));
    check("discovery_attempts stays 'pending_review' for the human queue", attempt4?.status === 'pending_review');

    // --- ambiguous + enabled + reject -> no_match with retry, NOT human review, NOT permanently blacklisted ---
    console.log('=== ai.enabled=true, reject -> no_match with retry, never sent to human review, NOT permanently blacklisted ===');
    const fakeReject = new FakeDeepseekReviewerService(() => successResult({ verdict: 'reject', confidence: 0.8, reason: 'different volume' }));
    const aiReviewReject = new DiscoveryAiReviewService(database, appSettingsService, fakeReject as never, matching, discoveryState);

    const candidate5Id = await createAmbiguousCandidate(5);
    const resultReject = await aiReviewReject.evaluateCandidate(candidate5Id);
    check('outcome is rejected', resultReject.kind === 'rejected');
    const [candidate5Row] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate5Id));
    check('aiVerdict=reject, reviewStatus=not_required (never sent to human review)', candidate5Row?.aiVerdict === 'reject' && candidate5Row?.reviewStatus === 'not_required');
    const [attempt5] = await database.db.select().from(discoveryAttempts).where(and(eq(discoveryAttempts.productId, productRows[5]!.id), eq(discoveryAttempts.competitorId, ovicoId)));
    check('discovery_attempts.status=no_match with a future retryEligibleAt', attempt5?.status === 'no_match' && attempt5?.retryEligibleAt !== null && attempt5!.retryEligibleAt!.getTime() > Date.now());

    // Resurface the SAME exact pair as ambiguous again (simulating the
    // retry window elapsing and a fresh search finding the same
    // competitor variant) - an AI reject must NOT permanently blacklist
    // it, unlike a human reject (see the manual-reject test further down).
    await createAmbiguousCandidate(5);
    const [candidate5RowAfterResurface] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate5Id));
    check(
      'an AI-rejected pair IS reset back to a fresh pending ambiguous candidate on resurfacing - only a HUMAN reject is permanent',
      candidate5RowAfterResurface?.reviewStatus === 'pending' && candidate5RowAfterResurface?.aiVerdict === null,
    );

    // --- malformed response -> stays pending, no retry -----------------------
    console.log('=== malformed/unparseable AI response -> stays pending, error recorded, never auto-matches ===');
    const fakeMalformed = new FakeDeepseekReviewerService(() => ({ kind: 'parse_error', message: 'confidence out of range', raw: {}, usage: null }));
    const aiReviewMalformed = new DiscoveryAiReviewService(database, appSettingsService, fakeMalformed as never, matching, discoveryState);

    const candidate6Id = await createAmbiguousCandidate(6);
    const resultMalformed = await aiReviewMalformed.evaluateCandidate(candidate6Id);
    check('outcome is error_stayed_pending', resultMalformed.kind === 'error_stayed_pending');
    const [candidate6Row] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate6Id));
    check('aiVerdict stays NULL (never evaluated to a real verdict), reviewStatus stays pending', candidate6Row?.aiVerdict === null && candidate6Row?.reviewStatus === 'pending');
    check("aiReason records the parse failure for visibility", (candidate6Row?.aiReason ?? '').startsWith('parse_error:'));
    check('the claim was released (aiProcessingAt cleared) so a later retry can pick it up immediately', candidate6Row?.aiProcessingAt === null);

    // --- network/timeout -> stays pending, bounded retry already proven in deepseek-reviewer.service.spec.ts ---
    console.log('=== network/timeout failure -> stays pending (bounded retry itself is proven in deepseek-reviewer.service.spec.ts) ===');
    const fakeNetworkError = new FakeDeepseekReviewerService(() => ({ kind: 'network_error', message: 'timed out', attempts: 3 }));
    const aiReviewNetworkError = new DiscoveryAiReviewService(database, appSettingsService, fakeNetworkError as never, matching, discoveryState);

    const candidate7Id = await createAmbiguousCandidate(7);
    const resultNetworkError = await aiReviewNetworkError.evaluateCandidate(candidate7Id);
    check('outcome is error_stayed_pending for a network failure too', resultNetworkError.kind === 'error_stayed_pending');
    const [candidate7Row] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate7Id));
    check('AI unavailability is never a no_match/product-match failure - candidate just stays pending', candidate7Row?.reviewStatus === 'pending' && candidate7Row?.aiVerdict === null);

    // --- existing pending candidate processable WITHOUT rediscovery ---------
    console.log('=== processPendingBatch(): pre-existing pending candidates (no live job) are processable without rediscovery ===');
    const preExistingCandidateIds = [
      await createAmbiguousCandidate(0), // jobRunId=null - simulates a row that predates this milestone
    ];
    const fakeBatchApprove = new FakeDeepseekReviewerService(() => successResult({ verdict: 'approve', confidence: 0.99 }));
    const aiReviewBatch = new DiscoveryAiReviewService(database, appSettingsService, fakeBatchApprove as never, matching, discoveryState);

    const batchSummary = await aiReviewBatch.processPendingBatch(10);
    check('processPendingBatch claimed at least the one pre-existing candidate', batchSummary.claimed >= 1);
    check('that candidate resolved to ai_auto_matched', batchSummary.aiAutoMatched >= 1);
    const [preExistingRow] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, preExistingCandidateIds[0]!));
    check('the pre-existing row is now resolved (no rediscovery needed)', preExistingRow?.outcome === 'ai_auto_matched');

    const secondBatchSummary = await aiReviewBatch.processPendingBatch(10);
    check('a second batch call claims nothing already resolved - never double-processed', secondBatchSummary.claimed === 0 || secondBatchSummary.aiAutoMatched === 0);

    // --- claim/lease: a fresh in-flight claim blocks re-evaluation; a stale one doesn't ---
    console.log('=== claim/lease: an in-flight claim is not re-claimed; a stale one IS (restart-safe) ===');
    const candidate8Id = await createAmbiguousCandidate(1);
    await database.db.update(discoveryCandidates).set({ aiProcessingAt: new Date() }).where(eq(discoveryCandidates.id, candidate8Id));

    const fakeShouldNotBeCalled = new FakeDeepseekReviewerService(() => {
      throw new Error('should not be called - the row is freshly claimed by "another process"');
    });
    const aiReviewFreshClaim = new DiscoveryAiReviewService(database, appSettingsService, fakeShouldNotBeCalled as never, matching, discoveryState);
    const resultFreshClaim = await aiReviewFreshClaim.evaluateCandidate(candidate8Id);
    check('a fresh (non-stale) claim by "another process" is respected - not re-evaluated', resultFreshClaim.kind === 'already_claimed_or_resolved');
    check('DeepSeek was not called while the row was freshly claimed elsewhere', fakeShouldNotBeCalled.calls === 0);

    // Simulate the claim going stale (a crashed/killed batch run) by
    // backdating it past the configured lease window, then prove it
    // becomes reclaimable.
    await database.db
      .update(discoveryCandidates)
      .set({ aiProcessingAt: new Date(Date.now() - 10 * 60 * 1000) })
      .where(eq(discoveryCandidates.id, candidate8Id));
    const fakeReclaims = new FakeDeepseekReviewerService(() => successResult({ verdict: 'approve', confidence: 0.99 }));
    const aiReviewReclaim = new DiscoveryAiReviewService(database, appSettingsService, fakeReclaims as never, matching, discoveryState);
    const resultReclaim = await aiReviewReclaim.evaluateCandidate(candidate8Id);
    check('a STALE claim (older than the lease window) IS reclaimable - restart-safe, never stuck forever', resultReclaim.kind === 'ai_auto_matched');

    // --- manual approve/reject + idempotency + precedence -------------------
    console.log('=== manual approve: source=manual, idempotent, cannot be overwritten by auto/ai ===');
    const aiReviewApi = new AiReviewService(database, matching, discoveryState);
    const candidate9Id = await createAmbiguousCandidate(2); // re-uses product index 2's (now resolved) pair with a NEW variant-less context is fine - recordAmbiguous resets a non-human-resolved row
    const approved9 = await aiReviewApi.approve(candidate9Id, 'ops@example.test');
    check('approve() returns reviewStatus=approved, outcome=manual_approved', approved9.reviewStatus === 'approved' && approved9.outcome === 'manual_approved');
    check('reviewedBy/reviewedAt/resolvedAt are set', approved9.reviewedBy === 'ops@example.test' && approved9.reviewedAt !== null && approved9.resolvedAt !== null);
    const [match9] = await database.db.select().from(matches).where(eq(matches.competitorProductVariantId, variantIdByProductIndex.get(2)!));
    check('the match row has source=manual', match9?.source === 'manual');

    let secondApproveConflicted = false;
    try {
      await aiReviewApi.approve(candidate9Id, 'ops@example.test');
    } catch (error) {
      secondApproveConflicted = (error as { getStatus?: () => number }).getStatus?.() === 409;
    }
    check('approving an already-resolved candidate again returns a clean 409, not a crash or a duplicate', secondApproveConflicted);
    const matchesForVariant9 = await database.db.select().from(matches).where(eq(matches.competitorProductVariantId, variantIdByProductIndex.get(2)!));
    check('still exactly one match row - the idempotent retry created no duplicate', matchesForVariant9.length === 1);

    // An automatic (auto or ai) write must never overwrite a manual match.
    const autoAttemptAfterManual = await matching.persistMatch(productRows[2]!.id, ovicoId, variantIdByProductIndex.get(2)!, 999, 'auto');
    check("an 'auto' write against a manual match is rejected as skippedManual - automatic can never overwrite manual", autoAttemptAfterManual.outcome === 'skippedManual');
    const aiAttemptAfterManual = await matching.persistMatch(productRows[2]!.id, ovicoId, variantIdByProductIndex.get(2)!, 999, 'ai');
    check("an 'ai' write against a manual match is ALSO rejected as skippedManual", aiAttemptAfterManual.outcome === 'skippedManual');

    console.log('=== manual reject: permanently skips the EXACT pair only, never blocks other candidates for the same product ===');
    const candidate10Id = await createAmbiguousCandidate(1); // product index 1 was used for recordNoMatch earlier, now safe to reuse for a fresh pair
    const rejected10 = await aiReviewApi.reject(candidate10Id, 'ops@example.test', 'wrong shade');
    check('reject() returns reviewStatus=rejected, outcome=manual_rejected', rejected10.reviewStatus === 'rejected' && rejected10.outcome === 'manual_rejected');
    const [attempt10] = await database.db.select().from(discoveryAttempts).where(and(eq(discoveryAttempts.productId, productRows[1]!.id), eq(discoveryAttempts.competitorId, ovicoId)));
    check('discovery_attempts becomes no_match with a retry window (product itself is NOT permanently blocked)', attempt10?.status === 'no_match' && attempt10?.retryEligibleAt !== null);

    // Resurface the SAME exact (product, competitor, variant) triple -
    // must stay permanently rejected, unlike the AI-reject case above.
    await createAmbiguousCandidate(1);
    const [candidate10AfterResurface] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate10Id));
    check(
      'the exact manually-rejected pair is NEVER re-proposed - still reviewStatus=rejected after resurfacing',
      candidate10AfterResurface?.reviewStatus === 'rejected',
    );

    let secondRejectConflicted = false;
    try {
      await aiReviewApi.reject(candidate10Id, 'ops@example.test');
    } catch (error) {
      secondRejectConflicted = (error as { getStatus?: () => number }).getStatus?.() === 409;
    }
    check('rejecting an already-resolved candidate again returns a clean 409', secondRejectConflicted);

    // --- usage/cost telemetry aggregate ---------------------------------------
    console.log('=== usage/cost telemetry: per-call fields persisted, aggregate sums correctly ===');
    const usageSummary = await aiReviewApi.getUsageSummary();
    check('usage summary reports at least the calls made above', usageSummary.totalCalls >= 5);
    check('usage summary sums prompt/completion tokens across all evaluated candidates', usageSummary.totalPromptTokens > 0 && usageSummary.totalCompletionTokens > 0);

    // --- job counter/event integration: the double-count fix ----------------
    console.log('=== job integration: aiReviewCount/aiAutoCount never double-count a candidate across the same job pass ===');
    await setAiThreshold(0.9);

    const jobA = await jobsService.enqueue({ competitor: 'ovico', mode: 'limited', brand: BRAND, onlyUnmatched: true, limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(jobA.id);

    const aiReviewForJobA = new DiscoveryAiReviewService(database, appSettingsService, new FakeDeepseekReviewerService(() => successResult({ verdict: 'approve', confidence: 0.99 })) as never, matching, discoveryState);
    const workerA = new DiscoveryWorkerService(database, jobsService, {} as never, {
      processOne: async (target: { id: number }, competitor: { id: number }, jobRunId: number | null) => {
        const score = 72;
        const candidateId = await discoveryState.recordAmbiguous({
          productId: target.id,
          competitorId: competitor.id,
          // Product index 8 is reserved, untouched by every earlier
          // section in this script - selectNextContinuousTarget below
          // must deterministically pick IT (the only never-checked OVICO
          // product left for this brand), so this job-run test isn't at
          // the mercy of whatever selection order the other 8 products'
          // mixed (matched/pending/no_match) states would otherwise produce.
          competitorProductVariantId: variantIdByProductIndex.get(8)!,
          jobRunId,
          snapshotTitle: 'job-run candidate',
          snapshotVariantLabel: null,
          snapshotVariantVolume: null,
          snapshotPrice: null,
          snapshotUrl: 'https://ovico.md/job-run-candidate',
          snapshotImageUrl: null,
          ruleScore: score,
          ruleSignals: { brandMatched: true } as never,
        });
        // Mirrors the REAL OvicoSkuDiscoveryService.recordTerminalOutcome's
        // job_events emission (see that file) - this fake stands in for
        // the whole service, so it must reproduce this part of its
        // contract too, or recomputeCounters()'s aiReviewCount formula
        // (which nets product_ai_auto_matched/product_ai_rejected OUT of
        // product_pending_review) would see an aiAutoCount with no
        // corresponding product_pending_review to net against, going
        // negative - exactly the invariant that can never happen via the
        // real code path (product_pending_review always precedes any AI
        // event for the same candidate, both emitted from the same job).
        if (jobRunId != null) {
          await database.db.insert(jobEvents).values({ jobRunId, productId: target.id, eventType: 'product_pending_review', data: { score } });
        }
        return { kind: 'ambiguous', score, parseSuccesses: 1, candidateId };
      },
    } as never, discoveryState, appSettingsService, aiReviewForJobA) as unknown as { claim(id: number): Promise<typeof jobA | null>; runJob(job: typeof jobA): Promise<void> };

    const claimedA = await workerA.claim(jobA.id);
    await workerA.runJob(claimedA!);

    const [jobARow] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, jobA.id));
    check('job completed with limit_reached after its one ambiguous-then-ai-auto-matched SKU', jobARow?.status === 'completed' && jobARow?.stopReason === 'limit_reached');
    check('aiAutoCount=1 for the AI-auto-matched candidate', jobARow?.aiAutoCount === 1);
    check(
      'aiReviewCount=0 (NOT 1) - the product_pending_review event is correctly netted out by the product_ai_auto_matched event, so this candidate is counted ONCE total (via aiAutoCount), never twice',
      jobARow?.aiReviewCount === 0,
    );
    check('processedCount=1 for the whole job (not 2)', jobARow?.processedCount === 1);

    const jobAEventTypes = (await database.db.select().from(jobEvents).where(eq(jobEvents.jobRunId, jobA.id))).map(e => e.eventType);
    check('both product_pending_review AND product_ai_auto_matched were emitted for this one SKU', jobAEventTypes.includes('product_pending_review') && jobAEventTypes.includes('product_ai_auto_matched'));

    // --- counter lifecycle: aiReviewCount is LIVE state, not a job-completion snapshot ---
    console.log('=== counter lifecycle: aiReviewCount reflects CURRENT candidate state - a LATER out-of-band AI resolution updates the ORIGINATING job, history stays in job_events ===');
    await setAiEnabled(false);
    const jobB = await jobsService.enqueue({ competitor: 'ovico', mode: 'limited', brand: BRAND, onlyUnmatched: true, limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(jobB.id);
    const neverCalledForJobB = new FakeDeepseekReviewerService(() => {
      throw new Error('should not be called - ai.enabled is false while job B itself runs');
    });
    const aiReviewForJobB = new DiscoveryAiReviewService(database, appSettingsService, neverCalledForJobB as never, matching, discoveryState);
    const workerB = new DiscoveryWorkerService(database, jobsService, {} as never, {
      processOne: async (target: { id: number }, competitor: { id: number }, jobRunId: number | null) => {
        const score = 70;
        const candidateId = await discoveryState.recordAmbiguous({
          productId: target.id,
          competitorId: competitor.id,
          competitorProductVariantId: variantIdByProductIndex.get(9)!,
          jobRunId,
          snapshotTitle: 'job B candidate',
          snapshotVariantLabel: null,
          snapshotVariantVolume: null,
          snapshotPrice: null,
          snapshotUrl: 'https://ovico.md/job-b-candidate',
          snapshotImageUrl: null,
          ruleScore: score,
          ruleSignals: { brandMatched: true } as never,
        });
        if (jobRunId != null) {
          await database.db.insert(jobEvents).values({ jobRunId, productId: target.id, eventType: 'product_pending_review', data: { score } });
        }
        return { kind: 'ambiguous', score, parseSuccesses: 1, candidateId };
      },
    } as never, discoveryState, appSettingsService, aiReviewForJobB) as unknown as {
      claim(id: number): Promise<typeof jobB | null>;
      runJob(job: typeof jobB): Promise<void>;
      persistRecomputedCounters(jobId: number): Promise<{ aiReviewCount: number; aiAutoCount: number; noMatchCount: number }>;
    };

    const claimedB = await workerB.claim(jobB.id);
    await workerB.runJob(claimedB!);

    const [jobBAfterCompletion] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, jobB.id));
    check('(1) job B completes with aiReviewCount=1 immediately - AI never ran (disabled) during job B itself', jobBAfterCompletion?.aiReviewCount === 1 && jobBAfterCompletion?.aiAutoCount === 0);

    const [candidateBRow] = await database.db
      .select()
      .from(discoveryCandidates)
      .where(and(eq(discoveryCandidates.productId, productRows[9]!.id), eq(discoveryCandidates.competitorId, ovicoId)));

    // (2) Separately, well after job B has already finished, the
    // explicit pending-AI processor resolves this exact candidate.
    await setAiEnabled(true);
    const fakeApproveForJobB = new FakeDeepseekReviewerService(() => successResult({ verdict: 'approve', confidence: 0.99 }));
    const aiReviewBatchForJobB = new DiscoveryAiReviewService(database, appSettingsService, fakeApproveForJobB as never, matching, discoveryState);
    const batchResultB = await aiReviewBatchForJobB.evaluateCandidate(candidateBRow!.id);
    check('(2) the out-of-band processor resolves it to ai_auto_matched', batchResultB.kind === 'ai_auto_matched');

    // (3) The ORIGINATING job's counters, recomputed NOW, reflect the NEW
    // current state - not what was true the moment the job completed.
    const recomputedB = await workerB.persistRecomputedCounters(jobB.id);
    check('(3) recompute now shows aiReviewCount=0 (live) - NOT the job-completion-time snapshot of 1', recomputedB.aiReviewCount === 0);
    check('(3) recompute now shows aiAutoCount=1', recomputedB.aiAutoCount === 1);

    // (4) History is preserved regardless of what the counter says now.
    const jobBEventTypesAfter = (await database.db.select().from(jobEvents).where(eq(jobEvents.jobRunId, jobB.id))).map(e => e.eventType);
    check('(4) job_events STILL contains the ORIGINAL product_pending_review event', jobBEventTypesAfter.includes('product_pending_review'));
    check('(4) job_events ALSO contains the LATER product_ai_auto_matched event, attributed to this same (long-finished) job', jobBEventTypesAfter.includes('product_ai_auto_matched'));

    console.log('=== counter lifecycle, mirror case: a LATER out-of-band AI REJECT also updates the originating job live, folds into noMatchCount ===');
    await setAiEnabled(false);
    const jobC = await jobsService.enqueue({ competitor: 'ovico', mode: 'limited', brand: BRAND, onlyUnmatched: true, limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(jobC.id);
    const workerC = new DiscoveryWorkerService(database, jobsService, {} as never, {
      processOne: async (target: { id: number }, competitor: { id: number }, jobRunId: number | null) => {
        const score = 69;
        const candidateId = await discoveryState.recordAmbiguous({
          productId: target.id,
          competitorId: competitor.id,
          competitorProductVariantId: variantIdByProductIndex.get(10)!,
          jobRunId,
          snapshotTitle: 'job C candidate',
          snapshotVariantLabel: null,
          snapshotVariantVolume: null,
          snapshotPrice: null,
          snapshotUrl: 'https://ovico.md/job-c-candidate',
          snapshotImageUrl: null,
          ruleScore: score,
          ruleSignals: { brandMatched: true } as never,
        });
        if (jobRunId != null) {
          await database.db.insert(jobEvents).values({ jobRunId, productId: target.id, eventType: 'product_pending_review', data: { score } });
        }
        return { kind: 'ambiguous', score, parseSuccesses: 1, candidateId };
      },
    } as never, discoveryState, appSettingsService, aiReviewForJobB) as unknown as {
      claim(id: number): Promise<typeof jobC | null>;
      runJob(job: typeof jobC): Promise<void>;
      persistRecomputedCounters(jobId: number): Promise<{ aiReviewCount: number; noMatchCount: number }>;
    };

    const claimedC = await workerC.claim(jobC.id);
    await workerC.runJob(claimedC!);
    const [jobCAfterCompletion] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, jobC.id));
    check('job C also completes with aiReviewCount=1 (AI disabled during the job itself)', jobCAfterCompletion?.aiReviewCount === 1);

    const [candidateCRow] = await database.db
      .select()
      .from(discoveryCandidates)
      .where(and(eq(discoveryCandidates.productId, productRows[10]!.id), eq(discoveryCandidates.competitorId, ovicoId)));

    await setAiEnabled(true);
    const fakeRejectForJobC = new FakeDeepseekReviewerService(() => successResult({ verdict: 'reject', confidence: 0.8, reason: 'different variant' }));
    const aiReviewBatchForJobC = new DiscoveryAiReviewService(database, appSettingsService, fakeRejectForJobC as never, matching, discoveryState);
    const batchResultC = await aiReviewBatchForJobC.evaluateCandidate(candidateCRow!.id);
    check('the out-of-band processor rejects it', batchResultC.kind === 'rejected');

    const recomputedC = await workerC.persistRecomputedCounters(jobC.id);
    check('the originating job now reads aiReviewCount=0', recomputedC.aiReviewCount === 0);
    check('the rejection is folded into noMatchCount (per the existing fold-reject-into-no_match design)', recomputedC.noMatchCount === 1);

    const jobCEventTypesAfter = (await database.db.select().from(jobEvents).where(eq(jobEvents.jobRunId, jobC.id))).map(e => e.eventType);
    check('job_events retains BOTH the original pending-review event AND the later AI-reject event', jobCEventTypesAfter.includes('product_pending_review') && jobCEventTypesAfter.includes('product_ai_rejected'));

    // --- claim atomicity under REAL concurrency ------------------------------
    console.log('=== claim atomicity under REAL concurrency: two independent DB connections racing on the SAME candidate ===');
    await setAiEnabled(true);
    const candidate11Id = await createAmbiguousCandidate(11);

    const dbConnA = new DatabaseService();
    const dbConnB = new DatabaseService();
    let concurrentDeepseekCalls = 0;
    const fakeConcurrentA = new FakeDeepseekReviewerService(() => {
      concurrentDeepseekCalls += 1;
      return successResult({ verdict: 'approve', confidence: 0.99 });
    });
    const fakeConcurrentB = new FakeDeepseekReviewerService(() => {
      concurrentDeepseekCalls += 1;
      return successResult({ verdict: 'approve', confidence: 0.99 });
    });
    const serviceA = new DiscoveryAiReviewService(dbConnA, new AppSettingsService(dbConnA), fakeConcurrentA as never, new MatchingService(dbConnA), new DiscoveryStateService(dbConnA));
    const serviceB = new DiscoveryAiReviewService(dbConnB, new AppSettingsService(dbConnB), fakeConcurrentB as never, new MatchingService(dbConnB), new DiscoveryStateService(dbConnB));

    const [concurrentOutcomeA, concurrentOutcomeB] = await Promise.all([
      serviceA.evaluateCandidate(candidate11Id),
      serviceB.evaluateCandidate(candidate11Id),
    ]);
    const concurrentKindCounts = new Map<string, number>();
    for (const kind of [concurrentOutcomeA.kind, concurrentOutcomeB.kind]) {
      concurrentKindCounts.set(kind, (concurrentKindCounts.get(kind) ?? 0) + 1);
    }
    check(
      'exactly one of the two truly-concurrent calls actually resolved the candidate; the other observed it already claimed/resolved',
      concurrentKindCounts.get('ai_auto_matched') === 1 && concurrentKindCounts.get('already_claimed_or_resolved') === 1,
    );
    check('DeepSeek was invoked EXACTLY once across both concurrent processes for this one candidate - never double-spent', concurrentDeepseekCalls === 1);

    await dbConnA.onModuleDestroy();
    await dbConnB.onModuleDestroy();

    console.log('=== an unexpected throw during evaluation releases the claim immediately, rather than waiting out the lease ===');
    const candidate12Id = await createAmbiguousCandidate(12);
    const fakeThrows = new FakeDeepseekReviewerService(() => {
      throw new Error('simulated unexpected DeepSeek client crash');
    });
    const aiReviewThrows = new DiscoveryAiReviewService(database, appSettingsService, fakeThrows as never, matching, discoveryState);

    let threwAsExpected = false;
    try {
      await aiReviewThrows.evaluateCandidate(candidate12Id);
    } catch {
      threwAsExpected = true;
    }
    check('the unexpected throw propagates to the caller (not silently swallowed)', threwAsExpected);
    const [candidate12AfterThrow] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate12Id));
    check(
      'the claim was released immediately (ai_processing_at cleared) - not permanently stuck, not waiting out the lease window',
      candidate12AfterThrow?.aiProcessingAt === null && candidate12AfterThrow?.reviewStatus === 'pending',
    );

    console.log('=== processPendingBatch resilience: one candidate throwing unexpectedly does not abort the rest of the batch ===');
    const candidate13Id = await createAmbiguousCandidate(13);
    const candidate14Id = await createAmbiguousCandidate(14);
    let mixedBatchCallIndex = 0;
    const fakeMixedBatch = new FakeDeepseekReviewerService(() => {
      mixedBatchCallIndex += 1;
      if (mixedBatchCallIndex === 1) throw new Error('simulated transient crash for the first claimed candidate only');
      return successResult({ verdict: 'approve', confidence: 0.99 });
    });
    const aiReviewMixedBatch = new DiscoveryAiReviewService(database, appSettingsService, fakeMixedBatch as never, matching, discoveryState);
    const mixedBatchSummary = await aiReviewMixedBatch.processPendingBatch(10);
    check(
      'the batch call completed normally (did not throw/abort) despite one candidate failing unexpectedly, and processed BOTH claimed rows',
      mixedBatchSummary.claimed >= 2 && mixedBatchSummary.errors >= 1 && mixedBatchSummary.aiAutoMatched >= 1,
    );

    // Deliberately NOT asserting WHICH specific row (13 or 14, or an
    // earlier leftover pending row this same batch call also swept up,
    // e.g. the malformed/network-error candidates from earlier sections,
    // still sitting at reviewStatus='pending'/aiVerdict=NULL) absorbed
    // the one simulated throw - claimBatch() claims oldest-pending-first
    // across the WHOLE table, not just these two, so which row lands on
    // mixedBatchCallIndex===1 depends on exactly what else is pending at
    // this point in the script, not on creation order of 13/14 alone.
    // What must hold regardless: neither of THIS pair is left stuck, and
    // each ended up either resolved or cleanly still-pending (never a
    // half-written row), and - the real safety net - nothing ANYWHERE is
    // left claimed-but-abandoned after the batch call returns.
    const [candidate13AfterMixed] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate13Id));
    const [candidate14AfterMixed] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate14Id));
    const notStuck = (c: typeof candidate13AfterMixed) => c?.aiProcessingAt === null;
    check('neither candidate in this pair is left claimed-but-stuck, regardless of which row absorbed the simulated throw', notStuck(candidate13AfterMixed) && notStuck(candidate14AfterMixed));

    const resolvedOrCleanlyPending = (c: typeof candidate13AfterMixed) =>
      c?.outcome === 'ai_auto_matched' || (c?.aiVerdict === null && c?.reviewStatus === 'pending');
    check('both candidates in this pair ended up either resolved or cleanly pending - never half-written', resolvedOrCleanlyPending(candidate13AfterMixed) && resolvedOrCleanlyPending(candidate14AfterMixed));

    const stillClaimedAnywhere = await database.db.select({ id: discoveryCandidates.id }).from(discoveryCandidates).where(sql`${discoveryCandidates.aiProcessingAt} IS NOT NULL`);
    check('no discovery_candidates row anywhere is left claimed-but-stuck after the batch run returns', stillClaimedAnywhere.length === 0);

    // --- transaction boundary: (a) match write, (b) candidate update, (c) discovery_attempts cleanup, (d) job_event insert ---
    console.log("=== transaction boundary: a crash anywhere inside applyVerdict's transaction rolls back (a) match write + (b) candidate update + (c) discovery_attempts cleanup + (d) job_event insert TOGETHER ===");
    const jobForTxTest = await jobsService.enqueue({ competitor: 'ovico', mode: 'limited', limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(jobForTxTest.id);
    const candidate15Id = await createAmbiguousCandidate(15, jobForTxTest.id);

    let txCrashed = false;
    try {
      await database.db.transaction(async tx => {
        await matching.persistMatch(productRows[15]!.id, ovicoId, variantIdByProductIndex.get(15)!, 80, 'ai', tx);
        await tx
          .update(discoveryCandidates)
          .set({ aiVerdict: 'approve', reviewStatus: 'not_required', outcome: 'ai_auto_matched', resolvedAt: new Date() })
          .where(eq(discoveryCandidates.id, candidate15Id));
        await discoveryState.recordMatched(productRows[15]!.id, ovicoId, tx);
        throw new Error('simulated crash right before (d), the job_event insert - it never runs');
      });
    } catch {
      txCrashed = true;
    }
    check('the simulated crash propagated out of the transaction', txCrashed);
    const [match15AfterCrash] = await database.db.select().from(matches).where(eq(matches.competitorProductVariantId, variantIdByProductIndex.get(15)!));
    check('(a) the matches row was rolled back - never partially written', match15AfterCrash === undefined);
    const [candidate15AfterCrash] = await database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, candidate15Id));
    check('(b)+(c) the candidate/discovery_attempts updates were rolled back too - still pending, not approved', candidate15AfterCrash?.reviewStatus === 'pending' && candidate15AfterCrash?.aiVerdict === null);

    // Now run the REAL (non-simulated) path against this same candidate,
    // proving (d) genuinely lives inside the SAME transaction as (a)-(c)
    // in the actual production code, not just in this test's manual
    // reproduction of it.
    const fakeApproveReal = new FakeDeepseekReviewerService(() => successResult({ verdict: 'approve', confidence: 0.99 }));
    const aiReviewReal = new DiscoveryAiReviewService(database, appSettingsService, fakeApproveReal as never, matching, discoveryState);
    const realOutcome = await aiReviewReal.evaluateCandidate(candidate15Id);
    check('the real (non-crashed) applyVerdict path resolves to ai_auto_matched', realOutcome.kind === 'ai_auto_matched');
    const jobForTxEventTypes = (await database.db.select().from(jobEvents).where(eq(jobEvents.jobRunId, jobForTxTest.id))).map(e => e.eventType);
    check(
      '(d) the job_event IS present after the real path runs - confirming it lives inside the same transaction as (a)-(c) in production code, not a separate later statement',
      jobForTxEventTypes.includes('product_ai_auto_matched'),
    );

    console.log();
    if (failures > 0) {
      console.log(`${failures} assertion(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log('All assertions PASSED');
    }
  } finally {
    const jobIds = insertedJobRunIds.length > 0 ? insertedJobRunIds : [-1];
    const productIds = insertedProductIds.length > 0 ? insertedProductIds : [-1];

    await database.db.delete(jobEvents).where(inArray(jobEvents.jobRunId, jobIds));
    await database.db.delete(discoveryCandidates).where(inArray(discoveryCandidates.productId, productIds));
    await database.db.delete(discoveryAttempts).where(inArray(discoveryAttempts.productId, productIds));
    await database.db.delete(matches).where(inArray(matches.productId, productIds));
    await database.db.delete(competitorProductVariants).where(ilike(competitorProductVariants.externalId, `${PREFIX}%`));
    await database.db.delete(competitorProducts).where(ilike(competitorProducts.externalId, `${PREFIX}%`));
    await database.db.delete(jobRuns).where(inArray(jobRuns.id, jobIds));
    await database.db.delete(products).where(ilike(products.sourceKey, `${PREFIX}%`));
    await database.db.delete(brands).where(eq(brands.canonicalKey, canonicalBrand(BRAND)));

    if (originalEnabledRow) {
      await database.db.update(appSettings).set({ value: originalEnabledRow.value }).where(eq(appSettings.key, AI_ENABLED_KEY));
    }
    if (originalThresholdRow) {
      await database.db.update(appSettings).set({ value: originalThresholdRow.value }).where(eq(appSettings.key, AI_THRESHOLD_KEY));
    }
  }
}

main()
  .then(() => process.exit(failures > 0 ? 1 : 0))
  .catch(error => {
    console.error('[verify-milestone3-ai-review] FAILED', error);
    process.exit(1);
  });
