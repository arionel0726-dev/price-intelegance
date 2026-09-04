import 'reflect-metadata';

import { createDatabase, eq, products } from '@price/db';

import { scoreCandidate } from '../src/matching/candidate-scoring';
import { canonicalBrand } from '../src/matching/matching-normalization';
import { buildCompetitorSearchQuery } from '../src/competitors/search-query-builder';

// Dev-only, read-only proof for the targeted-search milestone:
//
//   Vizaje DB product -> buildCompetitorSearchQuery -> search competitor ->
//   take top candidate URL(s) -> existing parser -> scoreCandidate (the
//   SAME function MatchingService.evaluateCandidate() delegates to - see
//   apps/api/src/matching/candidate-scoring.ts)
//
// NOTHING is written to the database - no competitor_products, no
// competitor_product_variants, no matches.
//
// Fixed 2026-09-04 (previous version had 3 real bugs, since corrected):
//   - used a Vizaje SKU/source_id value where the DB primary key `id` was
//     required for one test target
//   - built queries by hand-concatenating brand + raw name, duplicating the
//     brand and leaking the site's "| suffix" straight into the query
//   - duplicated the matcher's scoring logic instead of reusing it
// All three are now handled by shared, reusable code instead of by this
// script.
//
// Run with: bun run scripts/vizaje-competitor-search-proof.ts (from apps/api)

const PARSER_URL = process.env.PARSER_URL ?? 'http://localhost:8000';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://price:price@localhost:5432/price';

type TargetProduct = {
  vizajeId: number;
  competitor: 'makeup' | 'ovico';
  note: string;
};

// Real, website-confirmed Vizaje products (DB primary key `id`, verified
// against the schema - not source_id/SKU). Includes the 3 MAKEUP cases that
// were previously broken by query hygiene, plus the OVICO Romanian-
// concentration case.
const TARGETS: TargetProduct[] = [
  { vizajeId: 15620, competitor: 'makeup', note: 'Armani Acqua di Gioia 50ml - was ambiguous (score 88) due to "| Женская..." suffix' },
  { vizajeId: 15631, competitor: 'makeup', note: "Lancome La Vie Est Belle 50ml - was wrong-flanker candidates due to bad query" },
  { vizajeId: 4513, competitor: 'makeup', note: 'Elizabeth Arden Green Tea 50ml - was wrong-flanker candidates due to bad query' },
  { vizajeId: 1662, competitor: 'ovico', note: 'Versace Versense 50ml on OVICO - was reject (score 45) due to Romanian "Apă de toaletă"' },
];

type SearchResultItem = {
  external_id: string;
  title: string;
  brand: string | null;
  url: string;
  image_url: string | null;
};

type ParsedVariant = {
  external_id: string | null;
  label: string | null;
  volume: string | null;
  price: number | null;
  available: boolean;
};

type ParsedProduct = {
  competitor: string;
  external_id: string | null;
  title: string;
  brand: string | null;
  url: string;
  variants: ParsedVariant[];
};

async function callParser<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${PARSER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${path} returned ${response.status}: ${detail}`);
  }

  return (await response.json()) as T;
}

async function main() {
  const { db, client } = createDatabase(DATABASE_URL);

  try {
    for (const target of TARGETS) {
      const [vizaje] = await db
        .select({
          id: products.id,
          brand: products.brand,
          name: products.name,
          volume: products.volume,
          color: products.color,
          url: products.url,
        })
        .from(products)
        .where(eq(products.id, target.vizajeId))
        .limit(1);

      if (!vizaje) {
        console.log(`\n=== Vizaje id=${target.vizajeId}: NOT FOUND IN DB ===`);
        continue;
      }

      const query = buildCompetitorSearchQuery({ brand: vizaje.brand, name: vizaje.name });

      console.log(`\n=== Vizaje id=${vizaje.id} [${target.competitor}] — ${target.note} ===`);
      console.log(`  brand=${vizaje.brand} name=${vizaje.name} volume=${vizaje.volume ?? '-'} color=${vizaje.color ?? '-'}`);
      console.log(`  query: "${query}"`);

      const searchPath = target.competitor === 'makeup' ? '/search/makeup' : '/search/ovico';
      const search = await callParser<{ query: string; results: SearchResultItem[] }>(searchPath, {
        query,
        limit: 5,
      });

      console.log(`  candidates: ${search.results.length}`);

      if (search.results.length === 0) {
        console.log('  -> NO CANDIDATES FOUND');
        continue;
      }

      // Parse only the top 2 candidates - this is a discovery proof, not a
      // full re-crawl.
      for (const candidate of search.results.slice(0, 2)) {
        console.log(`  --- candidate: ${candidate.brand ?? '?'} | ${candidate.title} | ${candidate.url}`);

        const parsePath = target.competitor === 'makeup' ? '/parse/makeup/product' : '/parse/ovico/product';

        let parsed: ParsedProduct;
        try {
          parsed = await callParser<ParsedProduct>(parsePath, { url: candidate.url });
        } catch (error) {
          console.log(`      parse FAILED: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }

        console.log(`      parsed: "${parsed.title}" brand=${parsed.brand} variants=${parsed.variants.length}`);

        const brandMatch = canonicalBrand(vizaje.brand) === canonicalBrand(parsed.brand);

        for (const variant of parsed.variants) {
          const result = scoreCandidate(
            { brand: vizaje.brand, name: vizaje.name, volume: vizaje.volume, color: vizaje.color },
            { title: parsed.title, variantLabel: variant.label, variantVolume: variant.volume },
          );

          console.log(
            `        variant "${variant.label ?? variant.volume ?? '-'}" price=${variant.price ?? '-'} ` +
              `brandMatch=${brandMatch} similarity=${result.nameSimilarity.toFixed(2)} score=${result.score} ` +
              `decision=${brandMatch ? result.decision : 'reject(brand_gate)'}` +
              (result.rejectReason ? ` reason=${result.rejectReason}` : ''),
          );
        }
      }
    }
  } finally {
    await client.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[proof] FAILED', error);
    process.exit(1);
  });
