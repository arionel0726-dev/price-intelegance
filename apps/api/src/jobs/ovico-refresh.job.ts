import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { OvicoRefreshService } from '../competitors/ovico-refresh.service';
import { buildEnvelope } from './job-envelope';
import { JobLockService } from './job-lock.service';
import type { JobRunEnvelope } from './job-run.types';

const JOB_NAME = 'ovico-refresh';

// Daily, 03:30 Europe/Chisinau (after MakeupRefreshJob's typical window, so
// the two never contend for parser-service attention even though they hit
// different sites). Targets only Vizaje products that already have an
// OVICO match - known parent URL -> direct parse -> update variants/
// prices. No search. Still goes through the parser's own OVICO rate
// limiter per request (not bypassed) - with today's small OVICO match
// count this stays fast regardless. Shares the 'ovico' lock with
// OvicoDiscoveryJob.
@Injectable()
export class OvicoRefreshJob {
  private readonly logger = new Logger(OvicoRefreshJob.name);

  constructor(
    private readonly ovicoRefresh: OvicoRefreshService,
    private readonly lock: JobLockService,
  ) {}

  @Cron('30 3 * * *', {
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

  async run(): Promise<JobRunEnvelope<Awaited<ReturnType<OvicoRefreshService['refresh']>>>> {
    const startedAt = new Date();

    if (!this.lock.tryAcquire('ovico', JOB_NAME)) {
      return buildEnvelope<Awaited<ReturnType<OvicoRefreshService['refresh']>>>(this.logger, JOB_NAME, startedAt, 'skipped_locked', 'lock_held', null);
    }

    try {
      const detail = await this.ovicoRefresh.refresh();
      return buildEnvelope(this.logger, JOB_NAME, startedAt, 'success', undefined, detail);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return buildEnvelope<Awaited<ReturnType<OvicoRefreshService['refresh']>>>(this.logger, JOB_NAME, startedAt, 'failed', message, null);
    } finally {
      this.lock.release('ovico');
    }
  }
}
