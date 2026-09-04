import { Body, Controller, Post } from '@nestjs/common';

import { MakeupSyncService } from './makeup-sync.service';
import { OvicoSyncService } from './ovico-sync.service';

class CompetitorSyncBody {
  categoryUrl!: string;
  maxProducts?: number;
}

class CompetitorSyncProductBody {
  url!: string;
}

@Controller('competitors')
export class CompetitorsController {
  constructor(
    private readonly makeupSyncService: MakeupSyncService,
    private readonly ovicoSyncService: OvicoSyncService,
  ) {}

  @Post('makeup/sync')
  syncMakeup(@Body() body: CompetitorSyncBody) {
    return this.makeupSyncService.sync({
      categoryUrl: body.categoryUrl,
      maxProducts: body.maxProducts,
    });
  }

  @Post('makeup/sync-product')
  syncMakeupProduct(@Body() body: CompetitorSyncProductBody) {
    return this.makeupSyncService.syncProduct(body.url);
  }

  @Post('ovico/sync')
  syncOvico(@Body() body: CompetitorSyncBody) {
    return this.ovicoSyncService.sync({
      categoryUrl: body.categoryUrl,
      maxProducts: body.maxProducts,
    });
  }

  @Post('ovico/sync-product')
  syncOvicoProduct(@Body() body: CompetitorSyncProductBody) {
    return this.ovicoSyncService.syncProduct(body.url);
  }
}
