import { Body, Controller, Post } from '@nestjs/common';

import { VizajeSyncService } from './vizaje-sync.service';

class VizajeSyncBody {
  maxProducts?: number;
}

@Controller('vizaje')
export class VizajeSyncController {
  constructor(private readonly vizajeSyncService: VizajeSyncService) {}

  @Post('sync')
  sync(@Body() body: VizajeSyncBody) {
    return this.vizajeSyncService.sync(body.maxProducts);
  }
}
