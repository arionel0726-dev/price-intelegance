import { stripConcentrationTokens } from '../matching/matching-normalization';
import { cleanVizajeName } from '../matching/vizaje-name-cleanup';

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

  const brand = vizaje.brand.trim();

  // Vizaje names frequently repeat the brand as their own leading token
  // (e.g. "VERSACE Versense Туалетная вода") - without deduping this, the
  // query would carry the brand twice. Confirmed as a real bug in the first
  // draft of the dev proof script.
  const dedupedName = nameWithoutConcentration.startsWith(brand.toLowerCase())
    ? nameWithoutConcentration.slice(brand.length).trim()
    : nameWithoutConcentration;

  return `${brand} ${dedupedName}`.replace(/\s+/g, ' ').trim();
}
