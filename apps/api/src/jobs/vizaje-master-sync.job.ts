import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { VizajeSyncService } from '../vizaje/vizaje-sync.service';
import { buildEnvelope } from './job-envelope';
import { JobLockService } from './job-lock.service';
import type { JobRunEnvelope } from './job-run.types';

const JOB_NAME = 'vizaje-master-sync';

// Daily, off-peak, 02:00 Europe/Chisinau - runs BEFORE the MAKEUP/OVICO
// refresh jobs (03:00 / 03:30) so their "known match" data reflects the
// latest Vizaje catalog state first. Uses the EXISTING full-sync
// implementation unchanged (crawl -> global collision detection -> safe
// persistence -> skip conflicts -> preserve legacy-only products) - this
// job is only a scheduled, locked, logged wrapper around it.
@Injectable()
export class VizajeMasterSyncJob {
  private readonly logger = new Logger(VizajeMasterSyncJob.name);

  constructor(
    private readonly vizajeSync: VizajeSyncService,
    private readonly lock: JobLockService,
  ) {}

  @Cron('0 2 * * *', {
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

  async run(): Promise<JobRunEnvelope<Awaited<ReturnType<VizajeSyncService['fullSync']>>>> {
    const startedAt = new Date();

    if (!this.lock.tryAcquire('vizaje', JOB_NAME)) {
      return buildEnvelope<Awaited<ReturnType<VizajeSyncService['fullSync']>>>(this.logger, JOB_NAME, startedAt, 'skipped_locked', 'lock_held', null);
    }

    try {
      const detail = await this.vizajeSync.fullSync();
      return buildEnvelope(this.logger, JOB_NAME, startedAt, 'success', undefined, detail);
    } catch (error) {
      // Failure must never delete existing catalog data - fullSync() only
      // ever upserts safe SKUs and never truncates/deletes, so a thrown
      // error here simply means this run's updates stopped partway; the
      // previous catalog state is untouched.
      const message = error instanceof Error ? error.message : String(error);
      return buildEnvelope<Awaited<ReturnType<VizajeSyncService['fullSync']>>>(this.logger, JOB_NAME, startedAt, 'failed', message, null);
    } finally {
      this.lock.release('vizaje');
    }
  }
}
