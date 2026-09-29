// AFTER verification for the MAKEUP parser/matcher fixes, run through the
// real production service (MakeupTargetedSyncService.sync with explicit
// productIds - the same code path a real discovery run uses). Exercises the
// full pipeline for exactly the 5 curated fixtures from the discovery-
// quality investigation. No change to request pacing/batching. Real auto-
// matches found here DO get persisted, same as any real run would.
//
// Usage (from apps/api): bun run scripts/verify-makeup-fixtures.ts

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { MakeupTargetedSyncService } from '../src/competitors/makeup-targeted-sync.service';

// id -> label, matching the investigation's curated set exactly.
const FIXTURES: Record<number, string> = {
  1662: 'Versace Versense 50ml',
  8887: 'Lancôme Idôle 100ml',
  6623: 'Estée Lauder Perfectionist Pro Retinol Serum 30ml',
  12816: 'MAC Skinfinish Colourstruck Blush (Antique Velvet)',
  3164: 'Pupa Vamp! Lipstick 303',
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(MakeupTargetedSyncService);

  console.log('Running MakeupTargetedSyncService.sync PER FIXTURE (for clean per-product attribution)...\n');

  for (const [idStr, label] of Object.entries(FIXTURES)) {
    const id = Number(idStr);
    const result = await service.sync({ productIds: [id] });

    console.log(`--- id=${id} (${label}) ---`);
    console.log(
      `  found=${result.foundCandidates} parsed=${result.candidatesParsedTotal} auto=${result.auto} ambiguous=${result.ambiguous} noMatch=${result.noMatch}`,
    );

    for (const m of result.autoMatches) {
      console.log(`  AUTO -> "${m.competitorTitle}" ${m.variantVolume ?? m.variantLabel ?? ''} score=${m.score}`);
    }
  }

  await app.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
