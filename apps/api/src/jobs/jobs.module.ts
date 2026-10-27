import { Module } from '@nestjs/common';

import { CompetitorsModule } from '../competitors/competitors.module';
import { VizajeSyncModule } from '../vizaje/vizaje-sync.module';
import { DiscoveryJobsController } from './discovery-jobs.controller';
import { DiscoveryJobsService } from './discovery-jobs.service';
import { DiscoveryWorkerService } from './discovery-worker.service';
import { JobLockService } from './job-lock.service';
import { MakeupDiscoveryJob } from './makeup-discovery.job';
import { MakeupRefreshJob } from './makeup-refresh.job';
import { OvicoDiscoveryJob } from './ovico-discovery.job';
import { OvicoRefreshJob } from './ovico-refresh.job';
import { VizajeMasterSyncJob } from './vizaje-master-sync.job';

// Five independent, individually-runnable, individually-lockable legacy
// jobs - see project notes for why they are not one combined nightly job.
// Cron schedules are registered on each job class itself via @Cron(); this
// module just wires the DI graph. ScheduleModule.forRoot() is registered
// once in AppModule.
//
// Milestone 2 adds the DB-backed discovery job system alongside them:
// DiscoveryJobsController/Service (enqueue/list/get/events/stop, the
// job_runs-facing API) and DiscoveryWorkerService (the poller/claim/
// heartbeat/reconciliation/execution worker - see that file). JobLockService
// is kept for now (still used by the legacy run()/sync() manual/CLI path on
// each *DiscoveryJob/*RefreshJob class) - NOT yet a second competing lock
// for the same work, since DiscoveryWorkerService never consults it; see
// project notes on when it becomes safe to remove.
@Module({
  imports: [CompetitorsModule, VizajeSyncModule],
  controllers: [DiscoveryJobsController],
  providers: [
    JobLockService,
    VizajeMasterSyncJob,
    MakeupDiscoveryJob,
    MakeupRefreshJob,
    OvicoDiscoveryJob,
    OvicoRefreshJob,
    DiscoveryJobsService,
    DiscoveryWorkerService,
  ],
  exports: [
    VizajeMasterSyncJob,
    MakeupDiscoveryJob,
    MakeupRefreshJob,
    OvicoDiscoveryJob,
    OvicoRefreshJob,
    DiscoveryJobsService,
  ],
})
export class JobsModule {}
