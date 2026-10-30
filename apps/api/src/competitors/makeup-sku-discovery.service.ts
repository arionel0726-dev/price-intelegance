import { Injectable, Logger } from '@nestjs/common';
import { jobEvents, type DbOrTx } from '@price/db';

import { DatabaseService } from '../database/database.service';
import { scoreCandidate, type ScoredCandidate } from '../matching/candidate-scoring';
import { canonicalBrand } from '../matching/matching-normalization';
import { MatchingService } from '../matching/matching.service';
import { isPlausibleCandidate } from './candidate-prefilter';
import { CompetitorPersistenceService } from './competitor-persistence.service';
import { DiscoveryStateService } from './discovery-state.service';
import type { DiscoveryTarget } from './discovery-targets';
import { requestParsedProduct, requestSearchBatch } from './parser-client';
import type { ParsedProduct, ParsedVariant, SearchResponse } from './parser-client.types';
import { buildCompetitorSearchQuery } from './search-query-builder';
import type { SkuBudget, SkuOutcome } from './sku-discovery.types';

// Top-of-funnel cap: how many search results even get the cheap pre-filter
// considered. Unchanged from the pre-Milestone-2 MakeupTargetedSyncService.
const MAX_CANDIDATES_CONSIDERED = 5;
// How many of the plausible candidates actually get a full product-page
// parse. Unchanged.
const MAX_CANDIDATES_PARSED = 3;

// The ONE place MAKEUP per-SKU search/score/persist logic lives (Milestone
// 2 refactor - see project notes). Both the legacy batch
// MakeupTargetedSyncService.sync() and the new DiscoveryWorkerService call
// into this; neither duplicates scoring/persistence logic of its own.
// Batch-level concerns (cooldown pattern detection across several
// consecutive searches, inter-batch pacing, per-run safety-limit ratios)
// stay with the CALLER, since they are properties of a sequence of SKUs,
// not of any single one - see MakeupCooldownTracker for how the worker
// adapts the batch-level cooldown signal to one-SKU-at-a-time calls.
@Injectable()
export class MakeupSkuDiscoveryService {
	private readonly logger = new Logger(MakeupSkuDiscoveryService.name);
	private readonly parserUrl = process.env.PARSER_URL ?? 'http://localhost:8000';

	constructor(
		private readonly persistence: CompetitorPersistenceService,
		private readonly matching: MatchingService,
		private readonly discoveryState: DiscoveryStateService,
		private readonly database: DatabaseService,
	) {}

	// Makes the durable outcome write (discoveryState.recordX -
	// discovery_attempts/matches) and the job_events row for that SAME
	// outcome atomic with each other, closing the crash window the
	// counter/outcome idempotency review flagged: a job_events row now
	// never exists without its outcome already being durable, and vice
	// versa - job_events is safe to treat as authoritative for the
	// job_runs summary counters DiscoveryWorkerService recomputes from it
	// (see DiscoveryWorkerService.recomputeCounters). jobRunId is null
	// only on the legacy MakeupTargetedSyncService.sync() call path, which
	// has no job_runs row to attach an event to - there, just perform the
	// durable write with no transaction/event (byte-for-byte the
	// pre-Milestone-2 behavior for that path).
	private async recordTerminalOutcome<T>(
		write: (tx: DbOrTx) => Promise<T>,
		jobRunId: number | null,
		productId: number,
		eventType: string,
		data: Record<string, unknown>,
	): Promise<T> {
		if (jobRunId == null) {
			return write(this.database.db);
		}

		return this.database.db.transaction(async tx => {
			const result = await write(tx);
			await tx.insert(jobEvents).values({ jobRunId, productId, eventType, data, message: null });
			return result;
		});
	}

	// Single-item call against the SAME batch endpoint the legacy path uses
	// (MAKEUP's parser has no separate single-query endpoint) - one shared
	// request-building/response-shape implementation either way.
	async searchOne(vizaje: DiscoveryTarget): Promise<SearchResponse> {
		const query = buildCompetitorSearchQuery(vizaje);
		const response = await requestSearchBatch(this.parserUrl, '/search/makeup/batch', [query], 5);
		return response.results[0]!;
	}

	// Given an ALREADY-FETCHED search response for exactly one Vizaje
	// target (from searchOne() above, or from a legacy batch call), scores
	// candidates and persists the outcome - byte-for-byte the same decision
	// logic the pre-refactor MakeupTargetedSyncService.sync() had inline,
	// just extracted so it has exactly one implementation.
	async scoreAndPersist(
		vizaje: DiscoveryTarget,
		competitor: { id: number },
		search: SearchResponse,
		jobRunId: number | null,
		budget?: SkuBudget,
	): Promise<SkuOutcome> {
		if (search.results.length === 0) {
			await this.recordTerminalOutcome(
				tx => this.discoveryState.recordNoMatch(vizaje.id, competitor.id, jobRunId, tx),
				jobRunId, vizaje.id, 'product_no_match', {},
			);
			return { kind: 'no_match', parseSuccesses: 0 };
		}

		const plausible = search.results
			.filter(result => isPlausibleCandidate(vizaje, result))
			.slice(0, MAX_CANDIDATES_CONSIDERED)
			.slice(0, MAX_CANDIDATES_PARSED);

		if (plausible.length === 0) {
			await this.recordTerminalOutcome(
				tx => this.discoveryState.recordNoMatch(vizaje.id, competitor.id, jobRunId, tx),
				jobRunId, vizaje.id, 'product_no_match', {},
			);
			return { kind: 'no_match', parseSuccesses: 0 };
		}

		let bestAuto: { parsed: ParsedProduct; variant: ParsedVariant; result: ScoredCandidate } | null = null;
		let bestAmbiguous: { parsed: ParsedProduct; variant: ParsedVariant; result: ScoredCandidate } | null = null;
		let parseAttempts = 0;
		let parseSuccesses = 0;
		let stoppedByBudget = false;

		for (const candidate of plausible) {
			if (budget?.isExhausted()) {
				stoppedByBudget = true;
				break;
			}

			parseAttempts += 1;
			let parsed: ParsedProduct;

			try {
				parsed = await requestParsedProduct(this.parserUrl, '/parse/makeup/product', candidate.url);
			} catch (error) {
				this.logger.warn(`parse failed for ${candidate.url}: ${String(error)}`);
				continue;
			}

			parseSuccesses += 1;

			if (canonicalBrand(vizaje.brand) !== canonicalBrand(parsed.brand)) {
				continue;
			}

			for (const variant of parsed.variants) {
				const result = scoreCandidate(vizaje, {
					title: parsed.title,
					variantLabel: variant.label,
					variantVolume: variant.volume,
				});

				if (result.decision === 'auto') {
					if (!bestAuto || result.score > bestAuto.result.score) {
						bestAuto = { parsed, variant, result };
					}
				} else if (result.decision === 'ambiguous') {
					if (!bestAmbiguous || result.score > bestAmbiguous.result.score) {
						bestAmbiguous = { parsed, variant, result };
					}
				}
			}
		}

		if (bestAuto) {
			try {
				const persisted = await this.persistence.persistProduct(competitor.id, bestAuto.parsed);
				const variantId = bestAuto.variant.external_id
					? persisted.variantIdByExternalId.get(bestAuto.variant.external_id)
					: undefined;

				if (!variantId) {
					await this.recordTerminalOutcome(
						tx => this.discoveryState.recordError(vizaje.id, competitor.id, 'persist_error_missing_variant', jobRunId, tx),
						jobRunId, vizaje.id, 'product_error', { reason: 'persist_error_missing_variant' },
					);
					return { kind: 'error', reason: 'persist_error_missing_variant', parseSuccesses };
				}

				// The `matches` write itself (not discovery_attempts) is what
				// removes this SKU from future eligibility, and is the one
				// genuinely durable outcome write for AUTO - unlike
				// no_match/error/ambiguous, where discoveryState.recordX() IS
				// the whole outcome. So persistSingleAutoMatch() joins the
				// SAME transaction as recordMatched() and the job_events
				// insert, closing the exact gap the idempotency review
				// flagged for AUTO specifically: a crash between the matches
				// insert and the product_auto_matched event commit could
				// otherwise leave a correctly-matched (and so never
				// reselected/reprocessed) SKU with no event ever recorded
				// for it, which recompute-from-job_events can never recover
				// from on its own. jobRunId is null only on the legacy
				// MakeupTargetedSyncService.sync() call path, which has no
				// job_runs row to attach an event to - the transaction still
				// runs (for the matches+discovery_attempts pairing), it just
				// has nothing extra to insert.
				const outcome = await this.database.db.transaction(async tx => {
					const { outcome: matchOutcome } = await this.matching.persistSingleAutoMatch(
						vizaje.id, competitor.id, variantId, bestAuto.result.score, tx,
					);
					await this.discoveryState.recordMatched(vizaje.id, competitor.id, tx);
					if (jobRunId != null) {
						await tx.insert(jobEvents).values({
							jobRunId, productId: vizaje.id, eventType: 'product_auto_matched',
							data: { score: bestAuto.result.score, matchOutcome },
						});
					}
					return matchOutcome;
				});

				return {
					kind: 'auto',
					score: bestAuto.result.score,
					variantId,
					matchOutcome: outcome,
					competitorExternalId: bestAuto.parsed.external_id ?? '',
					competitorTitle: bestAuto.parsed.title,
					variantLabel: bestAuto.variant.label,
					variantVolume: bestAuto.variant.volume,
					price: bestAuto.variant.price,
					parseSuccesses,
				};
			} catch (error) {
				this.logger.warn(`persist failed for vizaje id=${vizaje.id}: ${String(error)}`);
				await this.recordTerminalOutcome(
					tx => this.discoveryState.recordError(vizaje.id, competitor.id, 'persist_error', jobRunId, tx),
					jobRunId, vizaje.id, 'product_error', { reason: 'persist_error' },
				);
				return { kind: 'error', reason: 'persist_error', parseSuccesses };
			}
		}

		if (bestAmbiguous) {
			try {
				const persisted = await this.persistence.persistProduct(competitor.id, bestAmbiguous.parsed);
				const variantId = bestAmbiguous.variant.external_id
					? persisted.variantIdByExternalId.get(bestAmbiguous.variant.external_id)
					: undefined;

				if (!variantId) {
					await this.recordTerminalOutcome(
						tx => this.discoveryState.recordError(vizaje.id, competitor.id, 'persist_error_missing_variant', jobRunId, tx),
						jobRunId, vizaje.id, 'product_error', { reason: 'persist_error_missing_variant' },
					);
					return { kind: 'error', reason: 'persist_error_missing_variant', parseSuccesses };
				}

				const candidateId = await this.recordTerminalOutcome(
					tx => this.discoveryState.recordAmbiguous({
						productId: vizaje.id,
						competitorId: competitor.id,
						competitorProductVariantId: variantId,
						jobRunId,
						snapshotTitle: bestAmbiguous.parsed.title,
						snapshotVariantLabel: bestAmbiguous.variant.label,
						snapshotVariantVolume: bestAmbiguous.variant.volume,
						snapshotPrice: bestAmbiguous.variant.price != null ? bestAmbiguous.variant.price.toFixed(2) : null,
						snapshotUrl: bestAmbiguous.parsed.url,
						snapshotImageUrl: bestAmbiguous.parsed.image_url,
						ruleScore: bestAmbiguous.result.score,
						ruleSignals: bestAmbiguous.result.signals,
					}, tx),
					jobRunId, vizaje.id, 'product_pending_review', { score: bestAmbiguous.result.score },
				);
				return { kind: 'ambiguous', score: bestAmbiguous.result.score, parseSuccesses, candidateId };
			} catch (error) {
				this.logger.warn(`candidate persist failed for vizaje id=${vizaje.id}: ${String(error)}`);
				await this.recordTerminalOutcome(
					tx => this.discoveryState.recordError(vizaje.id, competitor.id, 'candidate_persist_error', jobRunId, tx),
					jobRunId, vizaje.id, 'product_error', { reason: 'candidate_persist_error' },
				);
				return { kind: 'error', reason: 'candidate_persist_error', parseSuccesses };
			}
		}

		// Budget ran out before every plausible candidate could be tried, and
		// nothing conclusive came from the ones that were - a soft-budget
		// outcome, not a content-based no-match (see SkuBudget / project
		// notes: never abort an in-flight call, only skip STARTING another).
		if (stoppedByBudget && parseAttempts < plausible.length) {
			await this.recordTerminalOutcome(
				tx => this.discoveryState.recordError(vizaje.id, competitor.id, 'budget_exceeded', jobRunId, tx),
				jobRunId, vizaje.id, 'product_error', { reason: 'budget_exceeded' },
			);
			return { kind: 'error', reason: 'budget_exceeded', parseSuccesses };
		}

		if (parseAttempts > 0 && parseSuccesses === 0) {
			// Every candidate-page parse threw - an operational failure, not a
			// content-based no-match.
			await this.recordTerminalOutcome(
				tx => this.discoveryState.recordError(vizaje.id, competitor.id, 'candidate_parse_failed', jobRunId, tx),
				jobRunId, vizaje.id, 'product_error', { reason: 'candidate_parse_failed' },
			);
			return { kind: 'error', reason: 'candidate_parse_failed', parseSuccesses };
		}

		await this.recordTerminalOutcome(
			tx => this.discoveryState.recordNoMatch(vizaje.id, competitor.id, jobRunId, tx),
			jobRunId, vizaje.id, 'product_no_match', {},
		);
		return { kind: 'no_match', parseSuccesses };
	}
}
