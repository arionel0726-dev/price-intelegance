import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MakeupRefreshService } from '../competitors/makeup-refresh.service';
import { buildEnvelope } from './job-envelope';
import { JobLockService } from './job-lock.service';
import type { JobRunEnvelope } from './job-run.types';

const JOB_NAME = 'makeup-refresh';

// Daily, 03:00 Europe/Chisinau - after Vizaje sync (02:00). Targets only
// Vizaje products that ALREADY have a MAKEUP match: known parent URL ->
// direct parse -> update variants/prices. No search, so none of the
// MAKEUP-discovery pacing/cooldown machinery applies here (confirmed during
// the pacing milestone: product-page parsing stayed healthy throughout the
// search-cooldown incident). Shares the 'makeup' lock with
// MakeupDiscoveryJob so the two can never run concurrently.
@Injectable()
export class MakeupRefreshJob {
  private readonly logger = new Logger(MakeupRefreshJob.name);

  constructor(
    private readonly makeupRefresh: MakeupRefreshService,
    private readonly lock: JobLockService,
  ) {}

  @Cron('0 3 * * *', {
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

  async run(): Promise<JobRunEnvelope<Awaited<ReturnType<MakeupRefreshService['refresh']>>>> {
    const startedAt = new Date();

    if (!this.lock.tryAcquire('makeup', JOB_NAME)) {
      return buildEnvelope<Awaited<ReturnType<MakeupRefreshService['refresh']>>>(this.logger, JOB_NAME, startedAt, 'skipped_locked', 'lock_held', null);
    }

    try {
      const detail = await this.makeupRefresh.refresh();
      // Per-parent failures are captured in detail.failures - existing
      // price/data for a failed parent is left untouched (syncProduct only
      // upserts on success), never deleted.
      return buildEnvelope(this.logger, JOB_NAME, startedAt, 'success', undefined, detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return buildEnvelope<Awaited<ReturnType<MakeupRefreshService['refresh']>>>(this.logger, JOB_NAME, startedAt, 'failed', message, null);
    } finally {
      this.lock.release('makeup');
    }
  }
}
