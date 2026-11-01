import { Module } from '@nestjs/common';

import { OvicoBrandSourcesService } from './ovico-brand-sources.service';
import { OvicoCatalogPersistenceService } from './ovico-catalog-persistence.service';
import { OvicoCatalogSyncService } from './ovico-catalog-sync.service';

// Catalog Ingestion v1 (OVICO). DatabaseService is @Global (see
// database.module.ts), so nothing here needs to import it directly.
@Module({
	providers: [OvicoBrandSourcesService, OvicoCatalogPersistenceService, OvicoCatalogSyncService],
	exports: [OvicoBrandSourcesService, OvicoCatalogPersistenceService, OvicoCatalogSyncService]
})
export class OvicoCatalogModule {}
