import { Module } from '@nestjs/common';

import { PolicyService } from './policy.service';

// DatabaseModule is @Global (see database.module.ts), so PolicyService only
// needs to be provided/exported here, not re-wired to the DB connection.
@Module({
	providers: [PolicyService],
	exports: [PolicyService]
})
export class PolicyModule {}
