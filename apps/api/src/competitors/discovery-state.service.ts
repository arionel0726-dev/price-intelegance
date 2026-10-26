import { Injectable } from '@nestjs/common';
import { and, discoveryAttempts, discoveryCandidates, eq, sql } from '@price/db';

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
	// a status value here.
	async recordMatched(productId: number, competitorId: number): Promise<void> {
		await this.database.db
			.delete(discoveryAttempts)
			.where(and(eq(discoveryAttempts.productId, productId), eq(discoveryAttempts.competitorId, competitorId)));
	}

	async recordNoMatch(productId: number, competitorId: number, jobRunId?: number | null): Promise<void> {
		await this.upsertAttempt(productId, competitorId, {
			status: 'no_match',
			lastError: null,
			retryEligibleAt: new Date(Date.now() + NO_MATCH_RETRY_DAYS * 24 * 60 * 60 * 1000),
			jobRunId
		});
	}

	async recordError(
		productId: number,
		competitorId: number,
		lastError: string,
		jobRunId?: number | null
	): Promise<void> {
		await this.upsertAttempt(productId, competitorId, {
			status: 'error',
			lastError,
			retryEligibleAt: new Date(Date.now() + ERROR_RETRY_HOURS * 60 * 60 * 1000),
			jobRunId
		});
	}

	// Deterministic-ambiguous outcome: marks the pair pending_review AND
	// upserts the candidate snapshot in one call, since these two writes
	// must always happen together (a pending_review attempt with no
	// corresponding candidate row would be unreviewable, and vice versa).
	async recordAmbiguous(candidate: AmbiguousCandidateSnapshot): Promise<void> {
		const db = this.database.db;

		await db
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

				// AI fields stay NULL - no DeepSeek call exists yet. reviewStatus
				// is 'pending' (not 'not_required') so the fact that this SKU is
				// ambiguous is never lost: 'pending' + aiVerdict IS NULL means
				// "deterministic-ambiguous, awaiting the AI milestone"; a future
				// AI-approve-below-threshold candidate would ALSO be 'pending'
				// but with aiVerdict NOT NULL, so the two remain distinguishable
				// without a schema change.
				reviewStatus: 'pending'
			})
			.onConflictDoUpdate({
				target: [
					discoveryCandidates.productId,
					discoveryCandidates.competitorId,
					discoveryCandidates.competitorProductVariantId
				],
				set: {
					jobRunId: candidate.jobRunId ?? null,
					snapshotTitle: candidate.snapshotTitle,
					snapshotVariantLabel: candidate.snapshotVariantLabel,
					snapshotVariantVolume: candidate.snapshotVariantVolume,
					snapshotPrice: candidate.snapshotPrice,
					snapshotUrl: candidate.snapshotUrl,
					snapshotImageUrl: candidate.snapshotImageUrl,
					ruleScore: candidate.ruleScore,
					ruleSignals: candidate.ruleSignals
				}
			});

		await this.upsertAttempt(candidate.productId, candidate.competitorId, {
			status: 'pending_review',
			lastError: null,
			retryEligibleAt: null,
			jobRunId: candidate.jobRunId
		});
	}

	private async upsertAttempt(
		productId: number,
		competitorId: number,
		values: { status: string; lastError: string | null; retryEligibleAt: Date | null; jobRunId?: number | null }
	): Promise<void> {
		const now = new Date();

		await this.database.db
			.insert(discoveryAttempts)
			.values({
				productId,
				competitorId,
				status: values.status,
				attemptCount: 1,
				lastCheckedAt: now,
				lastJobRunId: values.jobRunId ?? null,
				lastError: values.lastError,
				retryEligibleAt: values.retryEligibleAt
			})
			.onConflictDoUpdate({
				target: [discoveryAttempts.productId, discoveryAttempts.competitorId],
				set: {
					status: values.status,
					attemptCount: sql`${discoveryAttempts.attemptCount} + 1`,
					lastCheckedAt: now,
					lastJobRunId: values.jobRunId ?? null,
					lastError: values.lastError,
					retryEligibleAt: values.retryEligibleAt,
					updatedAt: now
				}
			});
	}
}
