// Runs the REAL discovery pipeline (OvicoTargetedSyncService.sync, the
// exact production code path: buildCompetitorSearchQuery -> /search/ovico
// -> rankPlausibleCandidates -> /parse/ovico/product -> scoreCandidate)
// against the 15-product curated OVICO overlap validation set - each
// product manually confirmed beforehand to exist on OVICO with an exact
// matching volume + concentration (see the validation-set report). Never
// feeds the OVICO URL found during manual verification to the pipeline -
// the pipeline does its own fresh search from scratch, same as any real
// discovery run. One product at a time for clean per-product attribution.
//
// Usage (from apps/api): bun run scripts/verify-ovico-validation-set.ts

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { OvicoTargetedSyncService } from '../src/competitors/ovico-targeted-sync.service';

const VALIDATION_SET: { id: number; label: string; confirmedUrl: string }[] = [
	{ id: 845, label: 'Tom Ford Noir EDP 100ml', confirmedUrl: 'https://ovico.md/tf-noir-edp' },
	{ id: 1214, label: 'Antonio Banderas Blue Seduction Woman EDT 50ml', confirmedUrl: 'https://ovico.md/ab-blue-seduction-edt' },
	{ id: 1570, label: 'Moschino Cheap&Chic So Real EDT 30ml', confirmedUrl: 'https://ovico.md/moschino-chip-chic-so-real-edt' },
	{ id: 1579, label: 'Moschino Toy Boy EDP 50ml', confirmedUrl: 'https://ovico.md/moschino-toy-boy-edp' },
	{ id: 1662, label: 'Versace Versense EDT 50ml', confirmedUrl: 'https://ovico.md/versace-versense-edt' },
	{ id: 2775, label: 'Ferragamo Bright Leather EDT 50ml', confirmedUrl: 'https://ovico.md/fer-brigth-leathe-edt-full' },
	{ id: 3133, label: 'Lancome Idole Nectar EDP 50ml', confirmedUrl: 'https://ovico.md/lancome-idole-nectar' },
	{ id: 4746, label: 'Tom Ford Black Orchid EDT 100ml', confirmedUrl: 'https://ovico.md/tom-ford-black-orchid-old' },
	{ id: 6930, label: 'Ferragamo Signorina Unica EDP 50ml', confirmedUrl: 'https://ovico.md/signorina-unica' },
	{ id: 7758, label: 'Rabanne Olympea EDP 50ml', confirmedUrl: 'https://ovico.md/pr-olympea-edp' },
	{ id: 8887, label: 'Lancome Idole EDP 100ml', confirmedUrl: 'https://ovico.md/lancome-idole-eau-de-parfum' },
	{ id: 10762, label: 'Tom Ford Black Orchid Reserve EDP 100ml', confirmedUrl: 'https://ovico.md/black-orchid-reserve' },
	{ id: 12705, label: 'Rabanne Million Gold For Her EDP 50ml', confirmedUrl: 'https://ovico.md/rabanne-million-gold-for-her-parfum-65215865-comb' },
	{ id: 13010, label: 'YSL MYSLF Intense EDT 40ml', confirmedUrl: 'https://ovico.md/yves-saint-laurent-myslf-eau-de-toilette-intense-lf657000-comb' },
	{ id: 13827, label: 'Antonio Banderas King of Seduction EDT 50ml', confirmedUrl: 'https://ovico.md/ab-king-of-seduction-edt' },
];

async function main() {
	const app = await NestFactory.createApplicationContext(AppModule);
	const service = app.get(OvicoTargetedSyncService);

	let productsAttempted = 0;
	let searchRequests = 0;
	let candidateParses = 0;
	let auto = 0;
	let ambiguous = 0;
	let noMatch = 0;
	let errors = 0;

	console.log('Running the real OVICO discovery pipeline against the 15-product validation set...\n');

	for (const item of VALIDATION_SET) {
		const result = await service.sync({ productIds: [item.id] });

		productsAttempted += result.productsAttempted;
		searchRequests += result.searchRequests;
		candidateParses += result.candidateParses;
		auto += result.auto;
		ambiguous += result.ambiguous;
		noMatch += result.noMatch;
		errors += result.errors;

		const outcome = result.auto > 0 ? 'AUTO' : result.ambiguous > 0 ? 'AMBIGUOUS' : result.errors > 0 ? 'ERROR' : 'NO_MATCH';
		console.log(`id=${item.id} (${item.label}) confirmed-on-OVICO-at=${item.confirmedUrl}`);
		console.log(`  -> ${outcome} (search=${result.searchRequests} parsed=${result.candidateParses})`);

		for (const m of result.autoMatches) {
			console.log(`     matched: "${m.competitorTitle}" ${m.variantVolume ?? m.variantLabel ?? ''} score=${m.score}`);
		}
	}

	console.log('\n=== Aggregate ===');
	console.log(
		JSON.stringify(
			{ productsAttempted, searchRequests, candidateParses, auto, ambiguous, noMatch, errors },
			null,
			2,
		),
	);

	await app.close();
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
