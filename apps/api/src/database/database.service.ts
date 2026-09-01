import { Injectable, OnModuleDestroy } from '@nestjs/common';

import { createDatabase } from '@price/db';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly database = createDatabase(
    process.env.DATABASE_URL ?? 'postgresql://price:price@localhost:5432/price',
  );

  readonly db = this.database.db;

  async onModuleDestroy() {
    await this.database.client.end();
  }
}
