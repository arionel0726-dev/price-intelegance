import { Module } from '@nestjs/common';

import { MatchingModule } from '../matching/matching.module';
import { PolicyModule } from '../policy/policy.module';
import { CompetitorPersistenceService } from './competitor-persistence.service';
import { CompetitorsController } from './competitors.controller';
import { DiscoveryStateService } from './discovery-state.service';
import { MakeupRefreshService } from './makeup-refresh.service';
import { MakeupSkuDiscoveryService } from './makeup-sku-discovery.service';
import { MakeupSyncService } from './makeup-sync.service';
import { MakeupTargetedSyncService } from './makeup-targeted-sync.service';
import { OvicoRefreshService } from './ovico-refresh.service';
import { OvicoSkuDiscoveryService } from './ovico-sku-discovery.service';
import { OvicoSyncService } from './ovico-sync.service';
import { OvicoTargetedSyncService } from './ovico-targeted-sync.service';

@Module({
  imports: [MatchingModule, PolicyModule],
  controllers: [CompetitorsController],
  providers: [
    CompetitorPersistenceService,
    DiscoveryStateService,
    MakeupSyncService,
    OvicoSyncService,
    MakeupSkuDiscoveryService,
    OvicoSkuDiscoveryService,
    MakeupTargetedSyncService,
    OvicoTargetedSyncService,
    MakeupRefreshService,
    OvicoRefreshService,
  ],
  exports: [
    CompetitorPersistenceService,
    DiscoveryStateService,
    MakeupTargetedSyncService,
    OvicoTargetedSyncService,
    MakeupSkuDiscoveryService,
    OvicoSkuDiscoveryService,
    MakeupRefreshService,
    OvicoRefreshService,
  ],
})
export class CompetitorsModule {}
