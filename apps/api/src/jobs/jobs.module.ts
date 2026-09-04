import { Module } from '@nestjs/common';

import { CompetitorsModule } from '../competitors/competitors.module';
import { VizajeSyncModule } from '../vizaje/vizaje-sync.module';
import { JobLockService } from './job-lock.service';
import { MakeupDiscoveryJob } from './makeup-discovery.job';
import { MakeupRefreshJob } from './makeup-refresh.job';
import { OvicoDiscoveryJob } from './ovico-discovery.job';
import { OvicoRefreshJob } from './ovico-refresh.job';
import { VizajeMasterSyncJob } from './vizaje-master-sync.job';

// Five independent, individually-runnable, individually-lockable jobs - see
// project notes for why they are not one combined nightly job. Cron
// schedules are registered on each job class itself via @Cron(); this
// module just wires the DI graph. ScheduleModule.forRoot() is registered
// once in AppModule.
@Module({
  imports: [CompetitorsModule, VizajeSyncModule],
  providers: [
    JobLockService,
    VizajeMasterSyncJob,
    MakeupDiscoveryJob,
    MakeupRefreshJob,
    OvicoDiscoveryJob,
    OvicoRefreshJob,
  ],
  exports: [
    VizajeMasterSyncJob,
    MakeupDiscoveryJob,
    MakeupRefreshJob,
    OvicoDiscoveryJob,
    OvicoRefreshJob,
  ],
})
export class JobsModule {}
