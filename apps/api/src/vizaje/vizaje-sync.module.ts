import { Module } from '@nestjs/common';

import { VizajeBarcodeLookupService } from './vizaje-barcode-lookup.service';
import { VizajeSyncController } from './vizaje-sync.controller';
import { VizajeSyncService } from './vizaje-sync.service';

@Module({
  controllers: [VizajeSyncController],
  providers: [VizajeSyncService, VizajeBarcodeLookupService],
  exports: [VizajeSyncService],
})
export class VizajeSyncModule {}
