import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { OvicoTargetedSyncService } from '../competitors/ovico-targeted-sync.service';
import { buildEnvelope } from './job-envelope';
import { JobLockService } from './job-lock.service';
import type { JobRunEnvelope } from './job-run.types';

const JOB_NAME = 'ovico-discovery';

// Weekly (Sunday 08:00 Europe/Chisinau, well after MAKEUP discovery's usual
// completion window) - OVICO's 30s-per-request cost makes discovery
// expensive, so this stays small and infrequent. Targets only website-
// confirmed, not-yet-OVICO-matched Vizaje products, using the same
// id-ascending rotation cursor as MAKEUP discovery (separate queue key).
// Candidate parsing is already capped at 1-2 per product inside
// OvicoTargetedSyncService - unchanged this milestone. Shares the 'ovico'
// lock with OvicoRefreshJob.
const DEFAULT_LIMIT = Number(process.env.OVICO_DISCOVERY_RUN_LIMIT ?? 15);

@Injectable()
export class OvicoDiscoveryJob {
  private readonly logger = new Logger(OvicoDiscoveryJob.name);

  constructor(
    private readonly ovicoTargetedSync: OvicoTargetedSyncService,
    private readonly lock: JobLockService,
  ) {}

  @Cron('0 8 * * 0', {
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
  ): Promise<JobRunEnvelope<Awaited<ReturnType<OvicoTargetedSyncService['sync']>>>> {
    const startedAt = new Date();

    if (!this.lock.tryAcquire('ovico', JOB_NAME)) {
      return buildEnvelope<Awaited<ReturnType<OvicoTargetedSyncService['sync']>>>(this.logger, JOB_NAME, startedAt, 'skipped_locked', 'lock_held', null);
    }

    try {
      const detail = await this.ovicoTargetedSync.sync({ limit });
      return buildEnvelope(this.logger, JOB_NAME, startedAt, 'success', undefined, detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return buildEnvelope<Awaited<ReturnType<OvicoTargetedSyncService['sync']>>>(this.logger, JOB_NAME, startedAt, 'failed', message, null);
    } finally {
      this.lock.release('ovico');
    }
  }
}
