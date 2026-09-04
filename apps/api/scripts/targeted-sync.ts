import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { MakeupTargetedSyncService } from '../src/competitors/makeup-targeted-sync.service';
import { OvicoTargetedSyncService } from '../src/competitors/ovico-targeted-sync.service';

// Controlled, operational targeted-search sync. NOT the full ~11.5k-product
// discovery run - that is explicitly deferred until this milestone's
// results are reviewed. Run with (from apps/api):
//
//   bun run scripts/targeted-sync.ts --competitor=makeup --limit=60
//   bun run scripts/targeted-sync.ts --competitor=ovico --limit=8
//   bun run scripts/targeted-sync.ts --competitor=makeup --productIds=1,2,3
//
// A script (not an HTTP endpoint) on purpose - MAKEUP over dozens of
// products and OVICO's 30s-per-request cost can both run long enough that
// holding a browser-facing HTTP request open for it would repeat the exact
// mistake already fixed for the full Vizaje sync.

function parseArgs(): { competitor: 'makeup' | 'ovico'; limit?: number; productIds?: number[] } {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();

  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) flags.set(match[1]!, match[2]!);
  }

  const competitor = flags.get('competitor');
  if (competitor !== 'makeup' && competitor !== 'ovico') {
    throw new Error('Usage: --competitor=makeup|ovico [--limit=N] [--productIds=1,2,3]');
  }

  const limitRaw = flags.get('limit');
  const productIdsRaw = flags.get('productIds');

  return {
    competitor,
    limit: limitRaw ? Number(limitRaw) : undefined,
    productIds: productIdsRaw ? productIdsRaw.split(',').map(Number) : undefined,
  };
}

async function main() {
  const { competitor, limit, productIds } = parseArgs();
  const startedAt = new Date();

  console.log(
    `[targeted-sync] starting ${competitor} at ${startedAt.toISOString()} ` +
      `(limit=${limit ?? '-'}, productIds=${productIds?.length ?? '-'})`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const result =
      competitor === 'makeup'
        ? await app.get(MakeupTargetedSyncService).sync({ limit, productIds })
        : await app.get(OvicoTargetedSyncService).sync({ limit, productIds });

    const outPath = `${__dirname}/../../../data/vizaje/targeted-sync-${competitor}-${startedAt
      .toISOString()
      .replace(/[:.]/g, '-')}.json`;

    await writeFile(outPath, JSON.stringify(result, null, 2), 'utf-8');

    console.log('\n[targeted-sync] RESULT');
    console.log(JSON.stringify(result, null, 2));
    console.log(`\n[targeted-sync] full detail written to: ${outPath}`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[targeted-sync] FAILED', error);
    process.exit(1);
  });
