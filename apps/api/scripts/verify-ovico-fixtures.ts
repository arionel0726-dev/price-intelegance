// AFTER verification for the OVICO discovery/matching fixes, run through the
// real production service (OvicoTargetedSyncService.sync with explicit
// productIds - the same code path a real discovery run uses, including the
// new structured debug diagnostics). Exercises the full pipeline for
// exactly the 5 curated fixtures from the discovery-quality investigation.
// Respects the existing 30s/request OVICO rate limit - no changes to
// request pacing. Real auto-matches found here DO get persisted, same as
// any real run against these product ids would.
//
// Usage (from apps/api): bun run scripts/verify-ovico-fixtures.ts

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { OvicoTargetedSyncService } from '../src/competitors/ovico-targeted-sync.service';

// id -> label, matching the investigation's curated set exactly.
const FIXTURES: Record<number, string> = {
  1662: 'Versace Versense 50ml',
  8887: 'Lancôme Idôle 100ml',
  2699: 'Versace Eros Man Parfum 100ml',
  15880: 'YSL Black Opium Neon EDP 30ml',
  4594: 'Armani Acqua Di Gio Le Parfum 75ml',
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(OvicoTargetedSyncService);

  console.log('Running OvicoTargetedSyncService.sync against 5 curated fixtures...\n');
  const result = await service.sync({ productIds: Object.keys(FIXTURES).map(Number) });

  console.log('=== Aggregate result ===');
  console.log(
    JSON.stringify(
      {
        productsAttempted: result.productsAttempted,
        searchRequests: result.searchRequests,
        candidateParses: result.candidateParses,
        auto: result.auto,
        ambiguous: result.ambiguous,
        noMatch: result.noMatch,
        errors: result.errors,
      },
      null,
      2,
    ),
  );

  console.log('\n=== Auto matches persisted ===');
  for (const m of result.autoMatches) {
    console.log(
      `  id=${m.vizajeId} (${FIXTURES[m.vizajeId]}) -> "${m.competitorTitle}" ${m.variantVolume ?? m.variantLabel ?? ''} score=${m.score}`,
    );
  }

  await app.close();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
