import { Injectable, Logger } from '@nestjs/common';
import { jobEvents, type DbOrTx } from '@price/db';

import { DatabaseService } from '../database/database.service';
import { scoreCandidate, type ScoredCandidate } from '../matching/candidate-scoring';
import { MatchingService } from '../matching/matching.service';
import { rankPlausibleCandidates } from './candidate-prefilter';
import { CompetitorPersistenceService } from './competitor-persistence.service';
import { DiscoveryStateService } from './discovery-state.service';
import type { DiscoveryTarget } from './discovery-targets';
import { requestParsedProduct, requestSearch } from './parser-client';
import type { ParsedProduct, ParsedVariant, SearchResultItem } from './parser-client.types';
import { buildCompetitorSearchQuery } from './search-query-builder';
import type { SkuBudget, SkuOutcome } from './sku-discovery.types';

// OVICO costs ~30s per HTTP request (mandatory Crawl-delay: 30). Unchanged
// from the pre-Milestone-2 OvicoTargetedSyncService.
const MAX_CANDIDATES_PARSED = 2;

// The ONE place OVICO per-SKU search/score/persist logic lives (Milestone 2
// refactor). OVICO was already naturally one-SKU-at-a-time (no batching,
// no cross-SKU cooldown heuristic like MAKEUP) so this is a direct
// extraction of the pre-refactor OvicoTargetedSyncService.sync() loop body,
// now shared by that same legacy sync() and the new DiscoveryWorkerService.
@Injectable()
export class OvicoSkuDiscoveryService {
	private readonly logger = new Logger(OvicoSkuDiscoveryService.name);
	private readonly parserUrl = process.env.PARSER_URL ?? 'http://localhost:8000';

	constructor(
		private readonly persistence: CompetitorPersistenceService,
		private readonly matching: MatchingService,
		private readonly discoveryState: DiscoveryStateService,
		private readonly database: DatabaseService,
	) {}

	// See MakeupSkuDiscoveryService.recordTerminalOutcome for the full
	// rationale - identical helper, duplicated rather than shared because
	// the two services have no common base class and this is the only
	// piece they'd otherwise share.
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

	async processOne(
		vizaje: DiscoveryTarget,
		competitor: { id: number },
		jobRunId: number | null,
		budget?: SkuBudget,
	): Promise<SkuOutcome> {
		let ranked: (SearchResultItem & { prefilterSimilarity: number })[];

		if (budget?.isExhausted()) {
			await this.recordTerminalOutcome(
				tx => this.discoveryState.recordError(vizaje.id, competitor.id, 'budget_exceeded', jobRunId, tx),
				jobRunId, vizaje.id, 'product_error', { reason: 'budget_exceeded' },
			);
			return { kind: 'error', reason: 'budget_exceeded', parseSuccesses: 0 };
		}

		try {
			const query = buildCompetitorSearchQuery(vizaje);
			const search = await requestSearch(this.parserUrl, '/search/ovico', query, 5);
			// Cheap pre-ranking BEFORE any product-page fetch - OVICO's own
			// search order is not reliable.
			ranked = rankPlausibleCandidates(vizaje, search.results);
		} catch (error) {
			this.logger.warn(`search failed for vizaje id=${vizaje.id}: ${String(error)}`);
			await this.recordTerminalOutcome(
				tx => this.discoveryState.recordError(vizaje.id, competitor.id, 'search_error', jobRunId, tx),
				jobRunId, vizaje.id, 'product_error', { reason: 'search_error' },
			);
			return { kind: 'error', reason: 'search_error', parseSuccesses: 0 };
		}

		if (ranked.length === 0) {
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
		const toTry = ranked.slice(0, MAX_CANDIDATES_PARSED);

		for (const candidate of toTry) {
			if (budget?.isExhausted()) {
				stoppedByBudget = true;
				break;
			}

			parseAttempts += 1;
			let parsed: ParsedProduct;

			try {
				parsed = await requestParsedProduct(this.parserUrl, '/parse/ovico/product', candidate.url);
			} catch (error) {
				this.logger.warn(`parse failed for ${candidate.url}: ${String(error)}`);
				continue;
			}

			parseSuccesses += 1;

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

			// Stop after the first candidate unless it came back clearly weak
			// - "clearly weak" means nothing auto and nothing even ambiguous.
			if (bestAuto || bestAmbiguous) break;
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

				// See MakeupSkuDiscoveryService's identical AUTO branch for why
				// persistSingleAutoMatch() joins the SAME transaction as
				// recordMatched() and the job_events insert here - the
				// `matches` write is the one genuinely durable outcome write
				// for AUTO (unlike no_match/error/ambiguous), so it's the one
				// that must commit atomically with product_auto_matched to
				// close the counter/outcome idempotency gap for this outcome
				// specifically.
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

		if (stoppedByBudget && parseAttempts < toTry.length) {
			await this.recordTerminalOutcome(
				tx => this.discoveryState.recordError(vizaje.id, competitor.id, 'budget_exceeded', jobRunId, tx),
				jobRunId, vizaje.id, 'product_error', { reason: 'budget_exceeded' },
			);
			return { kind: 'error', reason: 'budget_exceeded', parseSuccesses };
		}

		if (parseAttempts > 0 && parseSuccesses === 0) {
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
