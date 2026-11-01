import 'reflect-metadata';

import { brands, competitors, eq } from '@price/db';

import { DatabaseService } from '../src/database/database.service';
import { OvicoBrandSourcesService } from '../src/competitors/ovico-catalog/ovico-brand-sources.service';
import { canonicalBrand } from '../src/matching/matching-normalization';

// Catalog Ingestion v1 (OVICO) - persists the 26 confirmed Vizaje-brand ->
// OVICO-brand-page mappings given for this milestone. These are confirmed
// input, not re-discovered here (per spec: "Do not discover these URLs
// again. Persist them."). Idempotent - re-running upserts on the
// (competitorId, sourceUrl) unique constraint, safe to run any number of
// times (e.g. after a brands-table backfill makes a previously-unresolved
// mapping resolvable).
//
// A brand name below that doesn't resolve to an existing brands.canonicalKey
// row is reported and SKIPPED, never used to invent a new canonical brand -
// per spec, "Vizaje brands remain canonical... Do not silently change
// canonical keys." This is expected and normal before brands has been
// populated by a real Vizaje sync (e.g. the local dev/demo seed only
// carries chanel/dior/givenchy/lancome) - re-run this script once the real
// brand catalog is present.
//
// Run with (from apps/api): bun run scripts/seed-ovico-brand-sources.ts

const OVICO_BRAND_SOURCES: Array<{ brand: string; url: string }> = [
  { brand: 'Antonio Banderas', url: 'https://ovico.md/ru/banderas' },
  { brand: 'Armani', url: 'https://ovico.md/ru/armani' },
  { brand: 'Armani', url: 'https://ovico.md/ru/armani-beauty' },
  { brand: 'Armani', url: 'https://ovico.md/ru/armani-prive' },
  { brand: 'Atkinsons', url: 'https://ovico.md/ru/atkinsons' },
  { brand: 'Benetton', url: 'https://ovico.md/ru/benetton' },
  { brand: 'Biotherm', url: 'https://ovico.md/ru/biotherm' },
  { brand: 'Carolina Herrera', url: 'https://ovico.md/ru/carolina-herrera' },
  { brand: 'Casamorati', url: 'https://ovico.md/ru/casamorati' },
  { brand: 'Clinique', url: 'https://ovico.md/ru/clinique' },
  { brand: 'Estee Lauder', url: 'https://ovico.md/ru/estee-lauder' },
  { brand: 'Ferragamo', url: 'https://ovico.md/ru/ferragamo' },
  { brand: 'Jean Paul Gaultier', url: 'https://ovico.md/ru/jean-paul-gaultier' },
  { brand: 'Juliette Has A Gun', url: 'https://ovico.md/ru/juliette-has-a-gun' },
  { brand: 'Lancome', url: 'https://ovico.md/ru/lancome' },
  { brand: 'Michael Kors', url: 'https://ovico.md/ru/michael-kors' },
  { brand: 'Moschino', url: 'https://ovico.md/ru/moschino' },
  { brand: 'Nina Ricci', url: 'https://ovico.md/ru/nina-ricci' },
  { brand: 'Prada', url: 'https://ovico.md/ru/prada' },
  { brand: 'Rabanne', url: 'https://ovico.md/ru/rabanne' },
  { brand: 'Sospiro Perfumes', url: 'https://ovico.md/ru/sospiro-perfumes' },
  { brand: 'Tom Ford', url: 'https://ovico.md/ru/tom-ford' },
  { brand: 'Valentino', url: 'https://ovico.md/ru/valentino' },
  { brand: 'Versace', url: 'https://ovico.md/ru/versace' },
  { brand: 'Xerjoff', url: 'https://ovico.md/ru/xerjoff' },
  { brand: 'Yves Saint Laurent', url: 'https://ovico.md/ru/yves-saint-laurent' },
  { brand: 'Yves Saint Laurent', url: 'https://ovico.md/ru/ysl-le-vestiaire-des-parfums' },
];

async function main() {
  const database = new DatabaseService();
  const brandSources = new OvicoBrandSourcesService(database);

  try {
    const [ovico] = await database.db
      .select({ id: competitors.id })
      .from(competitors)
      .where(eq(competitors.domain, 'ovico.md'))
      .limit(1);

    if (!ovico) {
      console.error('No competitors row with domain=ovico.md - nothing to seed against.');
      process.exitCode = 1;
      return;
    }

    const existingBrandKeys = new Set(
      (await database.db.select({ canonicalKey: brands.canonicalKey }).from(brands)).map(
        row => row.canonicalKey,
      ),
    );

    let seeded = 0;
    let skipped = 0;

    for (const { brand, url } of OVICO_BRAND_SOURCES) {
      const brandId = canonicalBrand(brand);

      if (!existingBrandKeys.has(brandId)) {
        console.log(`SKIP  ${brand} -> ${url} (no brands row for canonicalKey="${brandId}")`);
        skipped += 1;
        continue;
      }

      await brandSources.upsert({
        brandId,
        competitorId: ovico.id,
        sourceUrl: url,
        status: 'confirmed',
      });

      console.log(`OK    ${brand} -> ${url}`);
      seeded += 1;
    }

    console.log(`\n${seeded} source(s) seeded, ${skipped} skipped (brand not yet in brands table).`);
  } finally {
    await database.onModuleDestroy();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
