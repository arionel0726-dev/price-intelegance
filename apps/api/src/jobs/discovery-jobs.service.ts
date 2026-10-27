import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, jobEvents, jobRuns, type JobRun } from '@price/db';

import { CompetitorPersistenceService } from '../competitors/competitor-persistence.service';
import { DatabaseService } from '../database/database.service';
import { isValidProductBudgetSeconds } from '../competitors/sku-discovery.types';
import {
	DISCOVERY_COMPETITOR_DOMAINS,
	type DiscoveryCompetitorSlug,
	type DiscoveryJobParams,
	type EnqueueDiscoveryJobInput,
} from './discovery-jobs.types';

const COMPETITOR_NAME: Record<DiscoveryCompetitorSlug, string> = {
	makeup: 'MAKEUP',
	ovico: 'OVICO',
};

const ACTIVE_STATUSES = ['queued', 'running', 'stopping'] as const;
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

// Postgres unique_violation - see job_runs_active_per_competitor in
// packages/db/src/schema.ts. The `postgres` driver attaches `code` to the
// thrown error; drizzle propagates it unchanged.
const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class DiscoveryJobsService {
	constructor(
		private readonly database: DatabaseService,
		private readonly persistence: CompetitorPersistenceService,
	) {}

	// Validates, resolves the competitor row, inserts a 'queued' job_runs
	// row, and returns immediately - no discovery work happens inline here.
	// The DiscoveryWorkerService's poller picks this row up on its own
	// schedule (see that file).
	async enqueue(input: EnqueueDiscoveryJobInput): Promise<JobRun> {
		const domain = DISCOVERY_COMPETITOR_DOMAINS[input.competitor];
		if (!domain) {
			throw new BadRequestException(`Unknown competitor "${input.competitor}" - expected "makeup" or "ovico"`);
		}
		if (input.mode !== 'limited' && input.mode !== 'continuous') {
			throw new BadRequestException(`Unknown mode "${input.mode}" - expected "limited" or "continuous"`);
		}
		if (input.mode === 'limited' && (!input.limit || input.limit <= 0)) {
			throw new BadRequestException('limited mode requires a positive integer "limit"');
		}
		if (!isValidProductBudgetSeconds(input.productBudgetSeconds)) {
			throw new BadRequestException('productBudgetSeconds must be an integer between 30 and 1800 seconds');
		}

		const competitor = await this.persistence.getOrCreateCompetitor({
			name: COMPETITOR_NAME[input.competitor],
			domain,
		});

		const params: DiscoveryJobParams = {
			brand: input.brand ?? null,
			inStock: Boolean(input.inStock),
			onlyUnmatched: input.onlyUnmatched ?? true,
			limit: input.mode === 'limited' ? input.limit! : null,
			productBudgetSeconds: input.productBudgetSeconds,
		};

		try {
			const [row] = await this.database.db
				.insert(jobRuns)
				.values({
					competitorId: competitor.id,
					jobType: 'discovery',
					mode: input.mode,
					status: 'queued',
					params,
				})
				.returning();

			await this.emitEvent(row!.id, 'job_queued', null, { competitor: input.competitor, mode: input.mode });
			return row!;
		} catch (error) {
			// drizzle-orm wraps the real postgres driver error in a
			// DrizzleQueryError, with the original (which carries `.code`)
			// attached as `.cause` - check both shapes so this doesn't depend
			// on exactly which layer the code property survives on.
			const code =
				(error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
			if (code === POSTGRES_UNIQUE_VIOLATION) {
				throw new ConflictException(
					`A discovery job is already queued or running for ${input.competitor.toUpperCase()}`,
				);
			}
			throw error;
		}
	}

	async list(page: number, limit: number): Promise<{ items: JobRun[]; page: number; limit: number; total: number }> {
		const offset = (Math.max(1, page) - 1) * limit;

		const [items, [{ total }]] = await Promise.all([
			this.database.db.select().from(jobRuns).orderBy(desc(jobRuns.id)).limit(limit).offset(offset),
			this.database.db.select({ total: count() }).from(jobRuns),
		]);

		return { items, page: Math.max(1, page), limit, total: Number(total) };
	}

	async getOrThrow(id: number): Promise<JobRun> {
		const [row] = await this.database.db.select().from(jobRuns).where(eq(jobRuns.id, id));
		if (!row) throw new NotFoundException(`Discovery job ${id} not found`);
		return row;
	}

	async listEvents(
		jobId: number,
		page: number,
		limit: number,
	): Promise<{ items: (typeof jobEvents.$inferSelect)[]; page: number; limit: number; total: number }> {
		await this.getOrThrow(jobId);
		const offset = (Math.max(1, page) - 1) * limit;

		const [items, [{ total }]] = await Promise.all([
			this.database.db
				.select()
				.from(jobEvents)
				.where(eq(jobEvents.jobRunId, jobId))
				.orderBy(asc(jobEvents.id))
				.limit(limit)
				.offset(offset),
			this.database.db.select({ total: count() }).from(jobEvents).where(eq(jobEvents.jobRunId, jobId)),
		]);

		return { items, page: Math.max(1, page), limit, total: Number(total) };
	}

	// Queued (never claimed) -> cancel immediately, no need to wait for a
	// poll tick. Running/stopping -> only flip stopRequested; the worker's
	// own loop observes it at the next safe checkpoint (see
	// DiscoveryWorkerService). Already-terminal -> reject, nothing to stop.
	async requestStop(jobId: number): Promise<JobRun> {
		const now = new Date();

		const [directlyCancelled] = await this.database.db
			.update(jobRuns)
			.set({ status: 'cancelled', stopRequested: true, stopRequestedAt: now, stopReason: 'user_requested', finishedAt: now })
			.where(and(eq(jobRuns.id, jobId), eq(jobRuns.status, 'queued')))
			.returning();

		if (directlyCancelled) {
			await this.emitEvent(jobId, 'job_cancelled', null, { stopReason: 'user_requested', fromStatus: 'queued' });
			return directlyCancelled;
		}

		const [flagged] = await this.database.db
			.update(jobRuns)
			.set({ stopRequested: true, stopRequestedAt: now })
			.where(and(eq(jobRuns.id, jobId), inArray(jobRuns.status, ['running', 'stopping'])))
			.returning();

		if (flagged) {
			await this.emitEvent(jobId, 'job_stop_requested', null, {});
			return flagged;
		}

		const current = await this.getOrThrow(jobId);
		if ((TERMINAL_STATUSES as readonly string[]).includes(current.status)) {
			throw new BadRequestException(`Discovery job ${jobId} has already finished (status=${current.status})`);
		}
		return current;
	}

	// Small structured JSON only (see project notes) - never raw HTML or
	// full parser payloads. Shared by enqueue()/requestStop() above and by
	// DiscoveryWorkerService for every other event type.
	async emitEvent(
		jobRunId: number,
		eventType: string,
		productId: number | null,
		data: Record<string, unknown>,
		message?: string,
	): Promise<void> {
		await this.database.db.insert(jobEvents).values({
			jobRunId,
			productId,
			eventType,
			message: message ?? null,
			data,
		});
	}
}

export { ACTIVE_STATUSES, TERMINAL_STATUSES };
