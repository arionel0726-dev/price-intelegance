import { Injectable, Logger } from '@nestjs/common';
import { and, discoveryCandidates, eq, isNull, jobEvents, lt, or, type DiscoveryCandidate } from '@price/db';

import { DatabaseService } from '../database/database.service';
import { DiscoveryStateService } from '../competitors/discovery-state.service';
import { MatchingService } from '../matching/matching.service';
import { AppSettingsService } from '../policy/app-settings.service';
import { buildReviewInputForCandidate } from './ai-review-input';
import { AI_REVIEW_PROCESSING_LEASE_MS } from './deepseek.config';
import { DeepseekReviewerService } from './deepseek-reviewer.service';
import type { DeepseekUsage } from './deepseek-review.types';

export type AiEvaluationOutcome =
	| { kind: 'ai_auto_matched'; candidate: DiscoveryCandidate }
	| { kind: 'pending_review'; candidate: DiscoveryCandidate }
	| { kind: 'rejected'; candidate: DiscoveryCandidate }
	| { kind: 'unavailable'; reason: 'ai_disabled' | 'no_api_key' }
	| { kind: 'error_stayed_pending'; candidate: DiscoveryCandidate; message: string }
	// Another call already claimed/resolved this row - never double-
	// processed. Not an error; the caller (synchronous in-job path or a
	// concurrent batch call) just has nothing to do.
	| { kind: 'already_claimed_or_resolved' };

// The ONE place that evaluates an ambiguous discovery_candidates row
// against DeepSeek and applies the Milestone 3 decision lifecycle. Two
// entry points share this core:
//   - evaluateCandidate(id) - the synchronous in-job path
//     (DiscoveryWorkerService.runJob, right after a fresh
//     deterministic-ambiguous outcome), one candidate at a time, no
//     batching concerns.
//   - processPendingBatch(limit) - the out-of-band path for EXISTING
//     already-persisted pending_review+aiVerdict=NULL rows (processable
//     without rediscovery), bounded batch size, DB-backed claim so two
//     concurrent calls never double-process the same row.
// Neither auto-runs on app boot - processPendingBatch is only ever invoked
// explicitly (an endpoint/script), and evaluateCandidate only runs from
// inside an already-running discovery job.
@Injectable()
export class DiscoveryAiReviewService {
	private readonly logger = new Logger(DiscoveryAiReviewService.name);

	constructor(
		private readonly database: DatabaseService,
		private readonly appSettings: AppSettingsService,
		private readonly deepseek: DeepseekReviewerService,
		private readonly matching: MatchingService,
		private readonly discoveryState: DiscoveryStateService
	) {}

	// Single-candidate entry point - claims the row itself (safe to call
	// even if another process/call already claimed or resolved it; see
	// claimCandidate), then runs the full decision lifecycle. Returns a
	// discriminated outcome so the caller (DiscoveryWorkerService) can
	// decide exactly what, if anything, to emit as a job_event.
	async evaluateCandidate(candidateId: number): Promise<AiEvaluationOutcome> {
		if (!(await this.appSettings.getAiEnabled())) {
			return { kind: 'unavailable', reason: 'ai_disabled' };
		}

		if (!this.deepseek.isConfigured()) {
			this.logger.warn(
				`AI review requested for discovery_candidates ${candidateId} but DEEPSEEK_API_KEY is not configured - leaving it pending`
			);
			return { kind: 'unavailable', reason: 'no_api_key' };
		}

		const claimed = await this.claimCandidate(candidateId);
		if (!claimed) return { kind: 'already_claimed_or_resolved' };

		return this.evaluateClaimedCandidate(claimed);
	}

	// Out-of-band batch processor for pre-existing pending candidates -
	// e.g. rows created before AI review existed, or left behind while
	// ai.enabled was false. Claims up to `limit` rows in ONE atomic
	// UPDATE...RETURNING (oldest id first), then evaluates each serially.
	// Restart-safe: a crash mid-batch leaves claimed-but-unresolved rows
	// with a timestamped ai_processing_at, which becomes reclaimable by
	// the next call once AI_REVIEW_PROCESSING_LEASE_MS elapses - never
	// stuck forever, never double-processed while the lease is fresh.
	async processPendingBatch(limit = 20): Promise<{
		claimed: number;
		aiAutoMatched: number;
		pendingReview: number;
		rejected: number;
		unavailable: number;
		errors: number;
	}> {
		const summary = { claimed: 0, aiAutoMatched: 0, pendingReview: 0, rejected: 0, unavailable: 0, errors: 0 };

		if (!(await this.appSettings.getAiEnabled())) {
			return summary;
		}

		if (!this.deepseek.isConfigured()) {
			this.logger.warn('processPendingBatch called but DEEPSEEK_API_KEY is not configured - nothing to do');
			return summary;
		}

		const claimedRows = await this.claimBatch(limit);
		summary.claimed = claimedRows.length;

		for (const candidate of claimedRows) {
			// One bad candidate (an unexpected throw - evaluateClaimedCandidate
			// already released its own claim before rethrowing, see there)
			// must never abort the rest of an otherwise-healthy batch -
			// every other already-claimed row still needs processing, not
			// to be left claimed-and-abandoned until the lease expires.
			try {
				const outcome = await this.evaluateClaimedCandidate(candidate);

				switch (outcome.kind) {
					case 'ai_auto_matched':
						summary.aiAutoMatched += 1;
						break;
					case 'pending_review':
						summary.pendingReview += 1;
						break;
					case 'rejected':
						summary.rejected += 1;
						break;
					case 'unavailable':
						summary.unavailable += 1;
						break;
					case 'error_stayed_pending':
						summary.errors += 1;
						break;
					case 'already_claimed_or_resolved':
						// Cannot happen here - claimBatch() just claimed this
						// exact row - kept for exhaustiveness only.
						break;
				}
			} catch (error) {
				this.logger.error(`processPendingBatch: candidate ${candidate.id} failed unexpectedly, continuing with the rest of the batch: ${String(error)}`);
				summary.errors += 1;
			}
		}

		return summary;
	}

	// --- claiming -----------------------------------------------------------

	private staleBefore(): Date {
		return new Date(Date.now() - AI_REVIEW_PROCESSING_LEASE_MS);
	}

	private async claimCandidate(candidateId: number): Promise<DiscoveryCandidate | null> {
		const isUnclaimedOrStale = or(isNull(discoveryCandidates.aiProcessingAt), lt(discoveryCandidates.aiProcessingAt, this.staleBefore()));

		const [row] = await this.database.db
			.update(discoveryCandidates)
			.set({ aiProcessingAt: new Date() })
			.where(
				and(
					eq(discoveryCandidates.id, candidateId),
					eq(discoveryCandidates.reviewStatus, 'pending'),
					isNull(discoveryCandidates.aiVerdict),
					isUnclaimedOrStale
				)
			)
			.returning();

		return row ?? null;
	}

	private async claimBatch(limit: number): Promise<DiscoveryCandidate[]> {
		const isUnclaimedOrStale = or(isNull(discoveryCandidates.aiProcessingAt), lt(discoveryCandidates.aiProcessingAt, this.staleBefore()));

		// Two statements (select ids, then update exactly those ids) rather
		// than one UPDATE...LIMIT (Postgres has no LIMIT on UPDATE) - the
		// WHERE clause on the UPDATE is identical to the SELECT's, so a
		// row claimed by a concurrent call between the two statements
		// simply won't match the UPDATE's WHERE anymore and is silently
		// skipped, never double-claimed.
		const candidateIds = await this.database.db
			.select({ id: discoveryCandidates.id })
			.from(discoveryCandidates)
			.where(and(eq(discoveryCandidates.reviewStatus, 'pending'), isNull(discoveryCandidates.aiVerdict), isUnclaimedOrStale))
			.orderBy(discoveryCandidates.id)
			.limit(limit);

		if (candidateIds.length === 0) return [];

		const ids = candidateIds.map(row => row.id);

		return this.database.db
			.update(discoveryCandidates)
			.set({ aiProcessingAt: new Date() })
			.where(
				and(
					eq(discoveryCandidates.reviewStatus, 'pending'),
					isNull(discoveryCandidates.aiVerdict),
					isUnclaimedOrStale,
					or(...ids.map(id => eq(discoveryCandidates.id, id)))
				)
			)
			.returning();
	}

	// --- decision lifecycle ---------------------------------------------

	private async evaluateClaimedCandidate(candidate: DiscoveryCandidate): Promise<AiEvaluationOutcome> {
		// Hard-conflict invariant (Milestone 3, section 4): discovery_candidates
		// is only ever created for ruleDecision='ambiguous' (see
		// DiscoveryStateService.recordAmbiguous - the only writer of this
		// table). This is a defensive assertion, not a reachable branch in
		// correct operation - see discovery-ai-review.service.spec.ts.
		if (candidate.ruleDecision !== 'ambiguous') {
			throw new Error(
				`DiscoveryAiReviewService invariant violated: candidate ${candidate.id} has ruleDecision='${candidate.ruleDecision}', expected 'ambiguous' - a hard-reject/mismatch candidate must never reach AI review`
			);
		}

		// Review-round robustness fix: DeepseekReviewerService.reviewCandidate()
		// is designed to never throw for an EXPECTED failure mode (it
		// returns 'network_error'/'parse_error' instead - handled by name
		// below), but a genuinely unexpected exception here (a bug, an
		// OOM, buildReviewInputForCandidate failing to load an FK row,
		// etc.) must still never leave this candidate permanently claimed:
		// release the lease before rethrowing, so the very next claim
		// attempt (by anyone) can pick it up immediately rather than
		// waiting out AI_REVIEW_PROCESSING_LEASE_MS. The caller still
		// decides what the throw MEANS (discovery-worker.service.ts logs
		// and continues the job; processPendingBatch, below, catches it
		// per-candidate so one bad row can't abort the rest of the batch).
		try {
			const threshold = await this.appSettings.getAutoConfirmThreshold();
			const input = await buildReviewInputForCandidate(this.database, candidate);
			const result = await this.deepseek.reviewCandidate(input);

			switch (result.kind) {
				case 'unavailable':
					await this.releaseClaim(candidate.id);
					return { kind: 'unavailable', reason: result.reason };

				case 'network_error': {
					await this.markErrorStayedPending(candidate.id, `network_error: ${result.message} (${result.attempts} attempts)`);
					return { kind: 'error_stayed_pending', candidate, message: result.message };
				}

				case 'parse_error': {
					await this.markErrorStayedPending(candidate.id, `parse_error: ${result.message}`);
					return { kind: 'error_stayed_pending', candidate, message: result.message };
				}

				case 'success':
					return await this.applyVerdict(candidate, result, threshold);
			}
		} catch (error) {
			await this.releaseClaim(candidate.id);
			throw error;
		}
	}

	private async releaseClaim(candidateId: number): Promise<void> {
		await this.database.db.update(discoveryCandidates).set({ aiProcessingAt: null }).where(eq(discoveryCandidates.id, candidateId));
	}

	private async markErrorStayedPending(candidateId: number, reason: string): Promise<void> {
		// Visible diagnostic only - aiVerdict/aiEvaluatedAt stay NULL (this
		// candidate was NEVER actually evaluated), reviewStatus stays
		// 'pending', and the claim is released so a later retry (another
		// job pass, or a future processPendingBatch call) can pick it up
		// again immediately rather than waiting out the stale-lease window.
		await this.database.db
			.update(discoveryCandidates)
			.set({ aiReason: reason, aiProcessingAt: null })
			.where(eq(discoveryCandidates.id, candidateId));
	}

	private async applyVerdict(
		candidate: DiscoveryCandidate,
		result: { verdict: 'approve' | 'reject'; confidence: number; reason: string; signals: Record<string, unknown>; usage: DeepseekUsage },
		threshold: number
	): Promise<AiEvaluationOutcome> {
		const telemetry = {
			aiModel: result.usage.model,
			aiPromptTokens: result.usage.promptTokens,
			aiCompletionTokens: result.usage.completionTokens,
			aiTotalTokens: result.usage.totalTokens,
			aiLatencyMs: result.usage.latencyMs,
			aiEstimatedCostUsd:
				result.usage.estimatedCostUsd != null ? result.usage.estimatedCostUsd.toFixed(6) : null
		};

		const rawResponse = { verdict: result.verdict, confidence: result.confidence, reason: result.reason, signals: result.signals };

		if (result.verdict === 'reject') {
			await this.database.db.transaction(async tx => {
				await tx
					.update(discoveryCandidates)
					.set({
						aiVerdict: 'reject',
						aiConfidence: result.confidence.toFixed(2),
						aiReason: result.reason,
						aiRawResponse: rawResponse,
						aiEvaluatedAt: new Date(),
						aiThresholdUsed: threshold.toFixed(2),
						...telemetry,
						// reviewStatus='not_required' - never sent to human
						// review. outcome/resolvedAt stay NULL deliberately:
						// aiVerdict='reject' + reviewStatus='not_required'
						// already fully/unambiguously describes this
						// terminal state, and `outcome`'s check constraint
						// is reserved for the three values a human- or
						// AI-MATCH actually produces (ai_auto_matched/
						// manual_approved/manual_rejected) - see project
						// notes. Does NOT permanently blacklist the exact
						// pair - only a HUMAN reject does that (reviewStatus
						// stays out of 'rejected' here on purpose).
						reviewStatus: 'not_required',
						aiProcessingAt: null
					})
					.where(eq(discoveryCandidates.id, candidate.id));

				await this.discoveryState.recordNoMatch(candidate.productId, candidate.competitorId, candidate.jobRunId, tx);

				// Review-round fix: this job_event insert previously lived
				// OUTSIDE this transaction, in DiscoveryWorkerService's
				// switch-case - only reachable from the synchronous in-job
				// path, and (even there) a SEPARATE statement after this
				// transaction already committed. That meant (a) the
				// out-of-band processPendingBatch() path never produced
				// this event at all, so recomputeCounters() could never
				// see a LATER AI resolution of a candidate whose
				// product_pending_review was raised in an earlier,
				// already-finished job pass - aiReviewCount silently went
				// stale; and (b) a crash between this transaction
				// committing and that separate statement running could
				// leave a resolved candidate with no matching event. Both
				// are closed by writing it here, in the SAME transaction,
				// keyed to candidate.jobRunId (the job this candidate's
				// ambiguous detection actually belongs to - not necessarily
				// the caller's "current" job, which lets processPendingBatch
				// resolve a long-finished job's candidate and still have it
				// show up correctly the next time THAT job's counters are
				// recomputed). jobRunId is null only for candidates created
				// via the legacy *TargetedSyncService batch path (which
				// never had a job_runs row to begin with) - nothing to
				// attribute an event to there, so it's skipped.
				if (candidate.jobRunId != null) {
					await tx.insert(jobEvents).values({
						jobRunId: candidate.jobRunId,
						productId: candidate.productId,
						eventType: 'product_ai_rejected',
						data: { candidateId: candidate.id, confidence: result.confidence },
					});
				}
			});

			return { kind: 'rejected', candidate };
		}

		// verdict === 'approve'
		if (result.confidence >= threshold) {
			await this.database.db.transaction(async tx => {
				await this.matching.persistMatch(candidate.productId, candidate.competitorId, candidate.competitorProductVariantId, candidate.ruleScore, 'ai', tx);

				await tx
					.update(discoveryCandidates)
					.set({
						aiVerdict: 'approve',
						aiConfidence: result.confidence.toFixed(2),
						aiReason: result.reason,
						aiRawResponse: rawResponse,
						aiEvaluatedAt: new Date(),
						aiThresholdUsed: threshold.toFixed(2),
						...telemetry,
						reviewStatus: 'not_required',
						outcome: 'ai_auto_matched',
						resolvedAt: new Date(),
						aiProcessingAt: null
					})
					.where(eq(discoveryCandidates.id, candidate.id));

				await this.discoveryState.recordMatched(candidate.productId, candidate.competitorId, tx);

				// See the identical comment in the reject branch above - same
				// fix, same reasoning, same jobRunId-not-caller attribution.
				if (candidate.jobRunId != null) {
					await tx.insert(jobEvents).values({
						jobRunId: candidate.jobRunId,
						productId: candidate.productId,
						eventType: 'product_ai_auto_matched',
						data: { candidateId: candidate.id, confidence: result.confidence },
					});
				}
			});

			return { kind: 'ai_auto_matched', candidate };
		}

		// approve, but below threshold - stays in the human queue.
		await this.database.db
			.update(discoveryCandidates)
			.set({
				aiVerdict: 'approve',
				aiConfidence: result.confidence.toFixed(2),
				aiReason: result.reason,
				aiRawResponse: rawResponse,
				aiEvaluatedAt: new Date(),
				aiThresholdUsed: threshold.toFixed(2),
				...telemetry,
				reviewStatus: 'pending',
				aiProcessingAt: null
			})
			.where(eq(discoveryCandidates.id, candidate.id));

		return { kind: 'pending_review', candidate };
	}
}
