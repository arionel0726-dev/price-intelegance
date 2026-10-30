import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
	and,
	avg,
	competitors,
	count,
	desc,
	discoveryCandidates,
	eq,
	notInArray,
	sql,
	sum,
	type DbOrTx,
	type DiscoveryCandidate
} from '@price/db';

import { DatabaseService } from '../database/database.service';
import { DiscoveryStateService } from '../competitors/discovery-state.service';
import { MatchingService } from '../matching/matching.service';

export type AiReviewListFilters = {
	competitor?: string;
	reviewStatus?: string;
	page: number;
	limit: number;
};

// A human-terminal state can never be re-opened by anything in this
// system - see DiscoveryStateService.recordAmbiguous's onConflictDoUpdate
// guard, which is the other half of this invariant.
const HUMAN_TERMINAL_STATUSES: string[] = ['approved', 'rejected'];

// Human-facing side of Milestone 3 - the GET/approve/reject API backing
// `/ai-review` in apps/web. Distinct from DiscoveryAiReviewService (the AI
// decision engine itself): this service only ever reads discovery_candidates
// for display and applies a HUMAN decision, via the exact same
// MatchingService.persistMatch/DiscoveryStateService primitives the AI and
// AUTO paths already use - no separate precedence logic.
@Injectable()
export class AiReviewService {
	constructor(
		private readonly database: DatabaseService,
		private readonly matching: MatchingService,
		private readonly discoveryState: DiscoveryStateService
	) {}

	// Defaults to the unresolved human queue (reviewStatus='pending') -
	// callers that want AI-rejected/resolved history pass reviewStatus
	// explicitly.
	async list(filters: AiReviewListFilters): Promise<{
		items: DiscoveryCandidate[];
		page: number;
		limit: number;
		total: number;
	}> {
		const offset = (Math.max(1, filters.page) - 1) * filters.limit;
		const reviewStatus = filters.reviewStatus ?? 'pending';

		const conditions = [eq(discoveryCandidates.reviewStatus, reviewStatus)];

		if (filters.competitor) {
			const [competitorRow] = await this.database.db
				.select({ id: competitors.id })
				.from(competitors)
				.where(eq(competitors.domain, filters.competitor));

			if (!competitorRow) {
				return { items: [], page: filters.page, limit: filters.limit, total: 0 };
			}

			conditions.push(eq(discoveryCandidates.competitorId, competitorRow.id));
		}

		const where = and(...conditions);

		const [items, [{ total }]] = await Promise.all([
			this.database.db
				.select()
				.from(discoveryCandidates)
				.where(where)
				.orderBy(desc(discoveryCandidates.createdAt))
				.limit(filters.limit)
				.offset(offset),
			this.database.db.select({ total: count() }).from(discoveryCandidates).where(where)
		]);

		return { items, page: Math.max(1, filters.page), limit: filters.limit, total: Number(total) };
	}

	async getOrThrow(id: number): Promise<DiscoveryCandidate> {
		const [row] = await this.database.db.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, id));
		if (!row) throw new NotFoundException(`AI review candidate ${id} not found`);
		return row;
	}

	// Idempotent: a second approve/reject on an already-resolved row never
	// creates a duplicate match/event - the claiming UPDATE's WHERE excludes
	// rows already in a human-terminal state, so a second call simply
	// finds zero matching rows and gets a clean 409, never a 500.
	async approve(id: number, reviewedBy: string | null): Promise<DiscoveryCandidate> {
		return this.database.db.transaction(async tx => {
			// Claim AND apply the state transition in the SAME statement,
			// inside this SAME transaction, so there is no window between
			// "checked it's not yet resolved" and "resolved it" for a
			// concurrent approve/reject call to race into - see
			// claimForHumanDecision's doc comment for why a two-step
			// claim-then-update (even inside one transaction) is NOT
			// enough on its own.
			const claimed = await this.claimForHumanDecision(tx, id, {
				reviewStatus: 'approved',
				outcome: 'manual_approved',
				reviewedAt: new Date(),
				reviewedBy,
				resolvedAt: new Date()
			});

			await this.matching.persistMatch(
				claimed.productId,
				claimed.competitorId,
				claimed.competitorProductVariantId,
				claimed.ruleScore,
				'manual',
				tx
			);

			await this.discoveryState.recordMatched(claimed.productId, claimed.competitorId, tx);

			return claimed;
		});
	}

	async reject(id: number, reviewedBy: string | null, note?: string): Promise<DiscoveryCandidate> {
		return this.database.db.transaction(async tx => {
			const claimed = await this.claimForHumanDecision(tx, id, {
				reviewStatus: 'rejected',
				outcome: 'manual_rejected',
				reviewedAt: new Date(),
				reviewedBy,
				reviewNote: note ?? null,
				resolvedAt: new Date()
			});

			// A manual reject permanently blacklists ONLY this exact
			// (productId, competitorId, variantId) triple (enforced by the
			// discovery_candidates unique index + the onConflictDoUpdate
			// guard in recordAmbiguous - a row already 'rejected' is never
			// overwritten). It must NOT block other candidates for the
			// same product: recordNoMatch only touches the (productId,
			// competitorId) discovery_attempts row with the ordinary
			// no_match retry window, so a genuinely different competitor
			// variant (or even this one, resurfacing after the window -
			// which the guard above keeps permanently rejected) remains
			// discoverable.
			await this.discoveryState.recordNoMatch(claimed.productId, claimed.competitorId, claimed.jobRunId, tx);

			return claimed;
		});
	}

	// Cheap aggregate over usage/cost telemetry (Milestone 3, section 7) -
	// not a dashboard, just a sum/avg across every candidate AI has
	// actually evaluated (aiEvaluatedAt IS NOT NULL).
	async getUsageSummary(): Promise<{
		totalCalls: number;
		totalPromptTokens: number;
		totalCompletionTokens: number;
		totalTokens: number;
		totalEstimatedCostUsd: number;
		averageLatencyMs: number;
	}> {
		const [row] = await this.database.db
			.select({
				totalCalls: count(),
				totalPromptTokens: sum(discoveryCandidates.aiPromptTokens),
				totalCompletionTokens: sum(discoveryCandidates.aiCompletionTokens),
				totalTokens: sum(discoveryCandidates.aiTotalTokens),
				totalEstimatedCostUsd: sum(discoveryCandidates.aiEstimatedCostUsd),
				averageLatencyMs: avg(discoveryCandidates.aiLatencyMs)
			})
			.from(discoveryCandidates)
			.where(sql`${discoveryCandidates.aiEvaluatedAt} IS NOT NULL`);

		return {
			totalCalls: Number(row?.totalCalls ?? 0),
			totalPromptTokens: Number(row?.totalPromptTokens ?? 0),
			totalCompletionTokens: Number(row?.totalCompletionTokens ?? 0),
			totalTokens: Number(row?.totalTokens ?? 0),
			totalEstimatedCostUsd: Number(row?.totalEstimatedCostUsd ?? 0),
			averageLatencyMs: Number(row?.averageLatencyMs ?? 0)
		};
	}

	// Claims the row AND applies the real field update in ONE
	// UPDATE...WHERE...RETURNING, inside the caller's transaction - an
	// atomic "claim-and-resolve", not a separate claim step followed by a
	// second write. A two-step version (claim with a no-op touch, THEN
	// update) would still race: the no-op claim's own transaction could
	// commit and release its row lock before the real update runs,
	// letting a second concurrent call's claim succeed too. Doing both in
	// one statement closes that window - Postgres's row lock is held for
	// the statement that actually makes the row stop matching
	// notInArray(...HUMAN_TERMINAL_STATUSES), so only one of two
	// concurrent approve/reject calls can ever see a non-empty result.
	private async claimForHumanDecision(
		tx: DbOrTx,
		id: number,
		fields: Partial<DiscoveryCandidate>
	): Promise<DiscoveryCandidate> {
		const [claimed] = await tx
			.update(discoveryCandidates)
			.set(fields)
			.where(and(eq(discoveryCandidates.id, id), notInArray(discoveryCandidates.reviewStatus, HUMAN_TERMINAL_STATUSES)))
			.returning();

		if (claimed) return claimed;

		const existing = await tx.select().from(discoveryCandidates).where(eq(discoveryCandidates.id, id));
		if (existing.length === 0) throw new NotFoundException(`AI review candidate ${id} not found`);

		throw new ConflictException(
			`AI review candidate ${id} is already resolved (reviewStatus='${existing[0]!.reviewStatus}') - nothing to do`
		);
	}
}
