import 'reflect-metadata';

import { writeFile } from 'node:fs/promises';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { VizajeSyncService } from '../src/vizaje/vizaje-sync.service';

// Operational CLI entrypoint for a full-catalog Vizaje website sync.
// Run with: bun run vizaje:sync (from apps/api).
//
// This exists specifically because a full crawl+parse pass takes ~30
// minutes and persisting the ~11k safe SKUs afterward adds more on top -
// far too long to hold open as a browser-facing HTTP request. This process
// runs the whole thing to completion and prints/saves the result, then
// exits. `POST /vizaje/sync` (small/controlled batches, dev testing) is
// untouched and still available.
async function main() {
	const startedAt = new Date();
	console.log(`[vizaje:sync] starting full sync at ${startedAt.toISOString()}`);

	const app = await NestFactory.createApplicationContext(AppModule, {
		logger: ['log', 'warn', 'error']
	});

	try {
		const service = app.get(VizajeSyncService);
		const result = await service.fullSync();

		const outPath = `${__dirname}/../../../data/vizaje/full-sync-result-${startedAt
			.toISOString()
			.replace(/[:.]/g, '-')}.json`;

		await writeFile(outPath, JSON.stringify(result, null, 2), 'utf-8');

		console.log('\n[vizaje:sync] FULL SYNC RESULT SUMMARY');
		console.log(
			JSON.stringify(
				{
					familiesDiscovered: result.familiesDiscovered,
					familiesParsed: result.familiesParsed,
					familiesFailed: result.familiesFailed,
					variationEntries: result.variationEntries,
					distinctSkus: result.distinctSkus,
					crossFamilyCollisionCount: result.crossFamilyCollisionCount,
					safeSkuCount: result.safeSkuCount,
					updated: result.updated,
					inserted: result.inserted,
					barcodeEnriched: result.barcodeEnriched,
					identityUnresolved: result.identityUnresolved,
					legacyOnlyTotal: result.legacyOnlyAudit.totalLegacyOnly,
					durationMs: result.durationMs,
					durationMinutes: Math.round((result.durationMs / 60000) * 10) / 10
				},
				null,
				2
			)
		);
		console.log(`\n[vizaje:sync] full detail written to: ${outPath}`);
	} finally {
		await app.close();
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error('[vizaje:sync] FAILED', error);
		process.exit(1);
	});
