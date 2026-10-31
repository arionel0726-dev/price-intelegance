import { Module } from '@nestjs/common';

import { PolicyModule } from '../policy/policy.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

// Milestone 6 - Business Dashboard. Reuses PolicyService directly for
// effectivePriceMonitoringEnabled's precedence (never reimplemented) -
// same shape as AdminModule's imports in M5.
@Module({
	imports: [PolicyModule],
	controllers: [DashboardController],
	providers: [DashboardService]
})
export class DashboardModule {}
