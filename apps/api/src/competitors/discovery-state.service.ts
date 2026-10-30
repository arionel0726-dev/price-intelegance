import { Injectable } from '@nestjs/common';
import { and, discoveryAttempts, discoveryCandidates, eq, sql, type DbOrTx } from '@price/db';

import { DatabaseService } from '../database/database.service';
import type { MatchSignals } from '../matching/matching.types';

// Backoff windows for the two retryable terminal states. Deliberately NOT
// app_settings (per project notes: that table is reserved for true global
// business settings like the AI threshold, not operational pacing
// constants) - same class of value as MAKEUP_COOLDOWN_WAIT_MS and friends,
// so it lives in env the same way.
const NO_MATCH_RETRY_DAYS = Number(process.env.DISCOVERY_NO_MATCH_RETRY_DAYS ?? 7);
const ERROR_RETRY_HOURS = Number(process.env.DISCOVERY_ERROR_RETRY_HOURS ?? 24);

export type AmbiguousCandidateSnapshot = {
	productId: number;
	competitorId: number;
	competitorProductVariantId: number;
	jobRunId?: number | null;

	snapshotTitle: string;
	snapshotVariantLabel: string | null;
	snapshotVariantVolume: string | null;
	snapshotPrice: string | null;
	snapshotUrl: string;
	snapshotImageUrl: string | null;

	ruleScore: number;
	ruleSignals: MatchSignals;
};

// Single place that writes discoveryAttempts/discoveryCandidates - shared
// by MakeupTargetedSyncService and OvicoTargetedSyncService so the per-SKU
// outcome -> persisted-state mapping exists exactly once. See project
// architecture notes for the state machine this implements.
//
// Note on "processing": this milestone deliberately never writes
// status='processing'. That transient state only needs to be
// crash-recoverable once a job_runs-backed worker/poller exists (a later
// milestone) - until then, every targeted-sync run is a single synchronous
// call that always reaches a terminal outcome (or throws, in which case the
// row for that SKU is simply never written, which is indistinguishable from
// "never attempted" and is safe: nothing is left half-written).
@Injectable()
export class DiscoveryStateService {
	constructor(private readonly database: DatabaseService) {}

	// A confirmed match is represented ONLY by `matches` - clear any leftover
	// discovery_attempts row for the pair so "matched" is never duplicated as
	// a status value here. Accepts an optional `tx` so a caller (see
	// DiscoveryWorkerService / *SkuDiscoveryService) can join this write to
	// its own transaction, e.g. to make it atomic with the job_events insert
	// for the same outcome - see project notes on counter/outcome
	// idempotency across a crash.
	async recordMatched(productId: number, competitorId: number, tx?: DbOrTx): Promise<void> {
		await (tx ?? this.database.db)
			.delete(discoveryAttempts)
			.where(and(eq(discoveryAttempts.productId, productId), eq(discoveryAttempts.competitorId, competitorId)));
	}

	// Milestone 2: marks the pair as actively being worked by a live job.
	// Blocks reselection only while the owning job_run is itself
	// running/stopping (see discovery-targets.ts's blockedByDiscoveryAttempt)
	// - if that job dies, this exact row becomes selectable again with no
	// separate sweep required. jobRunId is REQUIRED here (unlike the other
	// record* methods) since a 'processing' row with no owner could never
	// be told apart from a dead one.
	async recordProcessing(productId: number, competitorId: number, jobRunId: number, tx?: DbOrTx): Promise<void> {
		await this.upsertAttempt(productId, competitorId, {
			status: 'processing',
			lastError: null,
			retryEligibleAt: null,
			jobRunId,
			incrementAttempt: false
		}, tx);
	}

	async recordNoMatch(productId: number, competitorId: number, jobRunId?: number | null, tx?: DbOrTx): Promise<void> {
		await this.upsertAttempt(productId, competitorId, {
			status: 'no_match',
			lastError: null,
			retryEligibleAt: new Date(Date.now() + NO_MATCH_RETRY_DAYS * 24 * 60 * 60 * 1000),
			jobRunId
		}, tx);
	}

	async recordError(
		productId: number,
		competitorId: number,
		lastError: string,
		jobRunId?: number | null,
		tx?: DbOrTx
	): Promise<void> {
		await this.upsertAttempt(productId, competitorId, {
			status: 'error',
			lastError,
			retryEligibleAt: new Date(Date.now() + ERROR_RETRY_HOURS * 60 * 60 * 1000),
			jobRunId
		}, tx);
	}

	// Deterministic-ambiguous outcome: marks the pair pending_review AND
	// upserts the candidate snapshot in one call, since these two writes
	// must always happen together (a pending_review attempt with no
	// corresponding candidate row would be unreviewable, and vice versa).
	// Returns the candidate row's id (Milestone 3: the caller - the
	// discovery worker - needs it to synchronously hand the candidate to
	// DeepseekReviewerService right after this commits, without a second
	// lookup-by-unique-key round trip).
	async recordAmbiguous(candidate: AmbiguousCandidateSnapshot, tx?: DbOrTx): Promise<number> {
		const db = tx ?? this.database.db;

		const [row] = await db
			.insert(discoveryCandidates)
			.values({
				productId: candidate.productId,
				competitorId: candidate.competitorId,
				competitorProductVariantId: candidate.competitorProductVariantId,
				jobRunId: candidate.jobRunId ?? null,

				snapshotTitle: candidate.snapshotTitle,
				snapshotVariantLabel: candidate.snapshotVariantLabel,
				snapshotVariantVolume: candidate.snapshotVariantVolume,
				snapshotPrice: candidate.snapshotPrice,
				snapshotUrl: candidate.snapshotUrl,
				snapshotImageUrl: candidate.snapshotImageUrl,

				ruleScore: candidate.ruleScore,
				ruleDecision: 'ambiguous',
				ruleSignals: candidate.ruleSignals,

				// reviewStatus starts 'pending' - aiVerdict IS NULL means
				// "deterministic-ambiguous, awaiting AI (or disabled)"; an
				// AI-approve-below-threshold candidate is ALSO 'pending' but
				// with aiVerdict NOT NULL, so the two stay distinguishable.
				reviewStatus: 'pending'
			})
			.onConflictDoUpdate({
				target: [
					discoveryCandidates.productId,
					discoveryCandidates.competitorId,
					discoveryCandidates.competitorProductVariantId
				],
				// Milestone 3: this exact (productId, competitorId,
				// variantId) triple can legitimately become ambiguous again
				// after an AI reject's no_match retry window elapses (only
				// a HUMAN reject/approve is permanent - see project notes),
				// so a fresh ambiguous detection normally DOES reset stale
				// AI/review state here. But if the existing row is already
				// human-resolved ('approved' or 'rejected'), this update
				// must be a complete no-op - that row must never be
				// un-rejected/un-approved by a later rediscovery pass. Every
				// field below is guarded by the same CASE so a
				// human-resolved row is left byte-for-byte untouched; the
				// `WHEN` branch reads the EXISTING (pre-conflict) column
				// value via a bare column reference, which is how Postgres
				// ON CONFLICT DO UPDATE exposes it. Selection logic upstream
				// (discovery-targets.ts) is ALSO responsible for never
				// routing a human-resolved pair back into a fresh search in
				// the first place - this guard is the second, defensive
				// layer, not the only one.
				set: {
					jobRunId: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.jobRunId} ELSE ${candidate.jobRunId ?? null} END`,
					snapshotTitle: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.snapshotTitle} ELSE ${candidate.snapshotTitle} END`,
					snapshotVariantLabel: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.snapshotVariantLabel} ELSE ${candidate.snapshotVariantLabel} END`,
					snapshotVariantVolume: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.snapshotVariantVolume} ELSE ${candidate.snapshotVariantVolume} END`,
					snapshotPrice: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.snapshotPrice} ELSE ${candidate.snapshotPrice} END`,
					snapshotUrl: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.snapshotUrl} ELSE ${candidate.snapshotUrl} END`,
					snapshotImageUrl: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.snapshotImageUrl} ELSE ${candidate.snapshotImageUrl} END`,
					ruleScore: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.ruleScore} ELSE ${candidate.ruleScore} END`,
					ruleSignals: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.ruleSignals} ELSE ${JSON.stringify(candidate.ruleSignals)}::jsonb END`,
					aiVerdict: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiVerdict} ELSE NULL END`,
					aiConfidence: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiConfidence} ELSE NULL END`,
					aiReason: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiReason} ELSE NULL END`,
					aiRawResponse: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiRawResponse} ELSE NULL END`,
					aiEvaluatedAt: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiEvaluatedAt} ELSE NULL END`,
					aiThresholdUsed: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiThresholdUsed} ELSE NULL END`,
					aiModel: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiModel} ELSE NULL END`,
					aiPromptTokens: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiPromptTokens} ELSE NULL END`,
					aiCompletionTokens: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiCompletionTokens} ELSE NULL END`,
					aiTotalTokens: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiTotalTokens} ELSE NULL END`,
					aiLatencyMs: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiLatencyMs} ELSE NULL END`,
					aiEstimatedCostUsd: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiEstimatedCostUsd} ELSE NULL END`,
					aiProcessingAt: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.aiProcessingAt} ELSE NULL END`,
					reviewStatus: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.reviewStatus} ELSE 'pending' END`,
					reviewedAt: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.reviewedAt} ELSE NULL END`,
					reviewedBy: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.reviewedBy} ELSE NULL END`,
					reviewNote: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.reviewNote} ELSE NULL END`,
					outcome: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.outcome} ELSE NULL END`,
					resolvedAt: sql`CASE WHEN ${discoveryCandidates.reviewStatus} IN ('approved', 'rejected') THEN ${discoveryCandidates.resolvedAt} ELSE NULL END`
				}
			})
			.returning({ id: discoveryCandidates.id });

		await this.upsertAttempt(candidate.productId, candidate.competitorId, {
			status: 'pending_review',
			lastError: null,
			retryEligibleAt: null,
			jobRunId: candidate.jobRunId
		}, tx);

		return row!.id;
	}

	private async upsertAttempt(
		productId: number,
		competitorId: number,
		values: {
			status: string;
			lastError: string | null;
			retryEligibleAt: Date | null;
			jobRunId?: number | null;
			// 'processing' is an in-flight marker, not a completed attempt -
			// it must not inflate attemptCount. The terminal write that
			// follows it (recordMatched/recordNoMatch/recordError/
			// recordAmbiguous) is what actually counts as the attempt, via
			// the conflict path incrementing from whatever recordProcessing
			// left behind. Defaults true so every existing call site keeps
			// its exact pre-existing counting behavior unchanged.
			incrementAttempt?: boolean;
		},
		tx?: DbOrTx
	): Promise<void> {
		const now = new Date();
		const incrementAttempt = values.incrementAttempt ?? true;

		await (tx ?? this.database.db)
			.insert(discoveryAttempts)
			.values({
				productId,
				competitorId,
				status: values.status,
				attemptCount: incrementAttempt ? 1 : 0,
				lastCheckedAt: now,
				lastJobRunId: values.jobRunId ?? null,
				lastError: values.lastError,
				retryEligibleAt: values.retryEligibleAt
			})
			.onConflictDoUpdate({
				target: [discoveryAttempts.productId, discoveryAttempts.competitorId],
				set: {
					status: values.status,
					attemptCount: incrementAttempt
						? sql`${discoveryAttempts.attemptCount} + 1`
						: discoveryAttempts.attemptCount,
					lastCheckedAt: now,
					lastJobRunId: values.jobRunId ?? null,
					lastError: values.lastError,
					retryEligibleAt: values.retryEligibleAt,
					updatedAt: now
				}
			});
	}
}
