import { Module } from '@nestjs/common';

import { AppSettingsService } from './app-settings.service';
import { PolicyService } from './policy.service';

// DatabaseModule is @Global (see database.module.ts), so PolicyService/
// AppSettingsService only need to be provided/exported here, not re-wired
// to the DB connection.
@Module({
	providers: [PolicyService, AppSettingsService],
	exports: [PolicyService, AppSettingsService]
})
export class PolicyModule {}
