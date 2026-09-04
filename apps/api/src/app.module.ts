import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CompetitorsModule } from './competitors/competitors.module';
import { DatabaseModule } from './database/database.module';
import { JobsModule } from './jobs/jobs.module';
import { MatchingModule } from './matching/matching.module';
import { ProductsModule } from './products/products.module';
import { VizajeSyncModule } from './vizaje/vizaje-sync.module';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Registered once; actual cron firing is gated per-job by
    // ENABLE_SCHEDULED_JOBS (see jobs/*.job.ts) so a dev/local process
    // never fires a real scheduled run just by being up.
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    ProductsModule,
    CompetitorsModule,
    MatchingModule,
    VizajeSyncModule,
    JobsModule,
  ],
})
export class AppModule {}
