import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MakeupTargetedSyncService } from '../competitors/makeup-targeted-sync.service';
import { buildEnvelope } from './job-envelope';
import { JobLockService } from './job-lock.service';
import type { JobRunEnvelope } from './job-run.types';

const JOB_NAME = 'makeup-discovery';

// Weekly (Sunday 04:00 Europe/Chisinau) - expensive relative to refresh, so
// not daily. Targets only website-confirmed, not-yet-MAKEUP-matched Vizaje
// products (see MakeupTargetedSyncService.loadTargets), using the id-
// ascending rotation cursor so a run doesn't reselect the same head of the
// table every week. 250/run keeps this to a single-night operation even
// with a cooldown event or two; the per-run safety limits (cooldown cap,
// deferred ratio, search-error ratio) mean a bad night stops itself rather
// than dragging on - the shared 'makeup' lock also keeps this from ever
// overlapping with MakeupRefreshJob.
const DEFAULT_LIMIT = Number(process.env.MAKEUP_DISCOVERY_RUN_LIMIT ?? 250);

@Injectable()
export class MakeupDiscoveryJob {
  private readonly logger = new Logger(MakeupDiscoveryJob.name);

  constructor(
    private readonly makeupTargetedSync: MakeupTargetedSyncService,
    private readonly lock: JobLockService,
  ) {}

  @Cron('0 4 * * 0', {
    name: JOB_NAME,
    timeZone: 'Europe/Chisinau',
    // Off by default - a scheduled run must be explicitly opted into via env,
    // never armed just because the API process happens to be running (e.g.
    // during local development). See project notes.
    disabled: process.env.ENABLE_SCHEDULED_JOBS !== 'true',
  })
  async runScheduled(): Promise<void> {
    await this.run();
  }

  async run(
    limit: number = DEFAULT_LIMIT,
  ): Promise<JobRunEnvelope<Awaited<ReturnType<MakeupTargetedSyncService['sync']>>>> {
    const startedAt = new Date();

    if (!this.lock.tryAcquire('makeup', JOB_NAME)) {
      return buildEnvelope<Awaited<ReturnType<MakeupTargetedSyncService['sync']>>>(this.logger, JOB_NAME, startedAt, 'skipped_locked', 'lock_held', null);
    }

    try {
      const detail = await this.makeupTargetedSync.sync({ limit });
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
