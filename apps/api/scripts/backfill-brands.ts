import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { brands, products } from '@price/db';

import { AppModule } from '../src/app.module';
import { DatabaseService } from '../src/database/database.service';
import { canonicalBrand } from '../src/matching/matching-normalization';

// One-time bootstrap for brands that already existed in `products` BEFORE
// this milestone shipped. vizaje-sync.service.ts's own ensureBrandsExist()
// only covers brands seen by a sync that runs AFTER this change deploys -
// this script covers the historical catalog so every existing brand has an
// all-enabled policy row from day one, with nothing left to silently
// default via `?? true` fallbacks in policy-precedence.ts (those fallbacks
// exist for safety/tests, not as the intended steady state).
//
// Idempotent - ON CONFLICT DO NOTHING, safe to re-run any time.
//
// Run with (from apps/api): bun run scripts/backfill-brands.ts

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const database = app.get(DatabaseService);

    const distinctBrands = await database.db.selectDistinct({ brand: products.brand }).from(products);

    const displayNameByCanonicalKey = new Map<string, string>();
    for (const row of distinctBrands) {
      const key = canonicalBrand(row.brand);
      if (!key || displayNameByCanonicalKey.has(key)) continue;
      displayNameByCanonicalKey.set(key, row.brand);
    }

    if (displayNameByCanonicalKey.size === 0) {
      console.log('[backfill-brands] no brands found in products - nothing to do');
      return;
    }

    const inserted = await database.db
      .insert(brands)
      .values(
        [...displayNameByCanonicalKey.entries()].map(([canonicalKey, displayName]) => ({
          canonicalKey,
          displayName,
        })),
      )
      .onConflictDoNothing({ target: brands.canonicalKey })
      .returning({ canonicalKey: brands.canonicalKey });

    console.log(
      `[backfill-brands] distinct raw brands=${distinctBrands.length} ` +
        `distinct canonical brands=${displayNameByCanonicalKey.size} newly inserted=${inserted.length}`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[backfill-brands] FAILED', error);
    process.exit(1);
  });
