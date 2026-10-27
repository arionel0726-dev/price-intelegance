import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MakeupTargetedSyncService } from '../competitors/makeup-targeted-sync.service';
import { DiscoveryJobsService } from './discovery-jobs.service';
import { buildEnvelope } from './job-envelope';
import { JobLockService } from './job-lock.service';
import type { JobRunEnvelope } from './job-run.types';

const JOB_NAME = 'makeup-discovery';

// Scheduled-run default soft per-SKU budget - only used by the Milestone 2
// job_runs-backed path runScheduled() now enqueues through (see below).
// Unrelated to the legacy run()/sync() path's own MAX_CANDIDATES_PARSED
// cap, which is still a candidate-count limit, not a time budget.
const SCHEDULED_PRODUCT_BUDGET_SECONDS = Number(process.env.MAKEUP_DISCOVERY_PRODUCT_BUDGET_SECONDS ?? 300);

// Weekly (Sunday 04:00 Europe/Chisinau) - expensive relative to refresh, so
// not daily. Targets only website-confirmed, not-yet-MAKEUP-matched Vizaje
// products (see MakeupTargetedSyncService / discovery-targets.ts), using the
// id-ascending rotation cursor so a run doesn't reselect the same head of the
// table every week. 250/run keeps this to a single-night operation even
// with a cooldown event or two; the per-run safety limits (cooldown cap,
// deferred ratio, search-error ratio) mean a bad night stops itself rather
// than dragging on - the shared 'makeup' lock also keeps this from ever
// overlapping with MakeupRefreshJob.
const DEFAULT_LIMIT = Number(process.env.MAKEUP_DISCOVERY_RUN_LIMIT ?? 250);

export type MakeupDiscoveryJobOptions = {
  limit?: number;
  brand?: string;
  inStock?: boolean;
  onlyUnmatched?: boolean;
};

@Injectable()
export class MakeupDiscoveryJob {
  private readonly logger = new Logger(MakeupDiscoveryJob.name);

  constructor(
    private readonly makeupTargetedSync: MakeupTargetedSyncService,
    private readonly lock: JobLockService,
    private readonly discoveryJobs: DiscoveryJobsService,
  ) {}

  @Cron('0 4 * * 0', {
    name: JOB_NAME,
    timeZone: 'Europe/Chisinau',
    // Off by default - a scheduled run must be explicitly opted into via env,
    // never armed just because the API process happens to be running (e.g.
    // during local development). See project notes. UNCHANGED by the
    // Milestone 2 refactor below - still gates whether this ever fires at
    // all, same as before.
    disabled: process.env.ENABLE_SCHEDULED_JOBS !== 'true',
  })
  // Milestone 2: a scheduled firing now ENQUEUES a job_runs row through the
  // same DiscoveryJobsService.enqueue() the API uses, rather than calling
  // MakeupTargetedSyncService.sync() directly - so once scheduled discovery
  // is turned on, it runs through the one DB-backed worker path, with
  // persisted progress/events/stop support, instead of a second,
  // competing execution route. The DiscoveryWorkerService's own poller
  // picks the row up - this method's job is only to enqueue and return.
  // run() below (still calling .sync() directly, still using
  // JobLockService) stays available unchanged for manual/CLI/diagnostic
  // use - see project notes on why that one code path was intentionally
  // left as-is rather than refactored too.
  async runScheduled(): Promise<void> {
    try {
      await this.discoveryJobs.enqueue({
        competitor: 'makeup',
        mode: 'limited',
        limit: DEFAULT_LIMIT,
        productBudgetSeconds: SCHEDULED_PRODUCT_BUDGET_SECONDS,
      });
    } catch (error) {
      this.logger.warn(`scheduled enqueue skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Accepts either a bare limit (legacy call shape - still used by
  // scripts/lock-test.ts and the plain `bun run jobs:makeup-discovery 100`
  // CLI form) or an options object carrying the optional brand/in-stock/
  // only-unmatched filters. Not two overloads - one param, normalized below -
  // so every existing call site keeps compiling unchanged.
  async run(
    limitOrOptions: number | MakeupDiscoveryJobOptions = DEFAULT_LIMIT,
  ): Promise<JobRunEnvelope<Awaited<ReturnType<MakeupTargetedSyncService['sync']>>>> {
    const startedAt = new Date();
    const options: MakeupDiscoveryJobOptions =
      typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions;
    const limit = options.limit ?? DEFAULT_LIMIT;

    if (!this.lock.tryAcquire('makeup', JOB_NAME)) {
      return buildEnvelope<Awaited<ReturnType<MakeupTargetedSyncService['sync']>>>(this.logger, JOB_NAME, startedAt, 'skipped_locked', 'lock_held', null);
    }

    try {
      const detail = await this.makeupTargetedSync.sync({
        limit,
        brand: options.brand,
        inStock: options.inStock,
        onlyUnmatched: options.onlyUnmatched,
      });
      const status = detail.status === 'stopped_early' ? 'stopped_early' : 'success';
      return buildEnvelope(this.logger, JOB_NAME, startedAt, status, detail.stopReason ?? undefined, detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return buildEnvelope<Awaited<ReturnType<MakeupTargetedSyncService['sync']>>>(this.logger, JOB_NAME, startedAt, 'failed', message, null);
    } finally {
      this.lock.release('makeup');
    }
  }
}
