import { brandSpellings, stripConcentrationTokens } from '../matching/matching-normalization';
import { cleanVizajeName } from '../matching/vizaje-name-cleanup';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Strips one standalone occurrence of `spelling` from either end of `name`
// (whole-word match only, so e.g. "pupa" never matches inside "puparazzi").
// Only start/end are considered - a brand mention embedded mid-name is left
// alone, since that's part of the actual product-line text, not a repeated
// brand token.
function stripBrandSpelling(name: string, spelling: string): string {
  const escaped = escapeRegExp(spelling);
  const startPattern = new RegExp(`^${escaped}\\b`, 'i');
  const endPattern = new RegExp(`\\b${escaped}$`, 'i');

  if (startPattern.test(name)) {
    return name.replace(startPattern, '').trim();
  }

  if (endPattern.test(name)) {
    return name.replace(endPattern, '').trim();
  }

  return name;
}

// The ONE reusable query builder for targeted competitor search (MAKEUP and
// OVICO both use it - no competitor-specific query logic without real
// evidence it's needed, per project notes). Validated during reconnaissance
// as the best-performing form: canonical brand + clean product-line name,
// WITHOUT volume, shade, price, sex metadata, the website's "|" presentation
// suffix, or barcode - all of those belong to candidate parsing and the
// matcher's variant-level gates, not to discovery.
export function buildCompetitorSearchQuery(vizaje: { brand: string; name: string }): string {
  const cleanedName = cleanVizajeName(vizaje.name).name;

  // stripConcentrationTokens lowercases as part of its normalization - fine
  // for a search query (every tested search engine here is case-insensitive,
  // confirmed during reconnaissance).
  const nameWithoutConcentration = stripConcentrationTokens(cleanedName);

  // Stray quote characters (Vizaje sometimes wraps the brand, e.g.
  // '... "PUPA"') add noise a competitor's search engine doesn't need -
  // strip them before brand dedup, not just cosmetically at the end.
  const withoutQuotes = nameWithoutConcentration
    .replace(/["'«»“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const brand = vizaje.brand.trim();

  // Vizaje names repeat the brand as their own token surprisingly often -
  // as a literal leading word ("VERSACE Versense ..."), as a known
  // abbreviation leading the name ("YSL Black Opium ..." for "Yves Saint
  // Laurent"), or trailing at the end ('Губная помада ... "PUPA"'). Without
  // deduping every one of those forms, the query carries the brand twice.
  // Tries every known spelling (own text + BRAND_ALIASES) at both ends,
  // longest first so a full brand name is preferred over a shorter alias
  // that happens to also match.
  let dedupedName = withoutQuotes;
  for (const spelling of brandSpellings(brand)) {
    dedupedName = stripBrandSpelling(dedupedName, spelling);
  }

  return `${brand} ${dedupedName}`.replace(/\s+/g, ' ').trim();
}
