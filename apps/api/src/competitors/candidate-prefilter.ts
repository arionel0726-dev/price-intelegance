import {
  canonicalBrand,
  nameSimilarity,
  normalizeName,
  stripConcentrationTokens,
} from '../matching/matching-normalization';
import { cleanVizajeName } from '../matching/vizaje-name-cleanup';

// Cheap pre-filter run on raw search-result metadata (title/brand only, no
// product page fetched yet) - its ONLY purpose is to avoid spending a parse
// (a Playwright page load for MAKEUP, a rate-limited request for OVICO) on
// candidates that are obviously unrelated. This is NOT the matcher: it never
// makes an auto/ambiguous/reject decision - that still only happens in
// scoreCandidate() after the candidate is actually parsed.
export function isPlausibleCandidate(
  vizaje: { brand: string; name: string },
  candidate: { title: string; brand: string | null },
): boolean {
  if (!candidate.brand) return false;
  if (canonicalBrand(vizaje.brand) !== canonicalBrand(candidate.brand)) return false;

  const vizajeName = stripConcentrationTokens(cleanVizajeName(vizaje.name).name);
  const candidateName = stripConcentrationTokens(candidate.title);

  // Any shared product-line token at all is enough to pass - this only
  // exists to catch a completely wrong search hit, not to rank quality.
  return nameSimilarity(normalizeName(vizajeName), normalizeName(candidateName)) > 0;
}

// Same cheap signal as isPlausibleCandidate, but ranks survivors instead of
// just filtering them. Exists specifically for OVICO: reconnaissance found
// its search results are NOT reliably ordered by relevance (an exact-title
// base product ranked 8th of 8 in one real test) - so before spending a
// ~30s-per-request parse, re-sort the plausible candidates by this cheap
// signal rather than trusting the site's own order. This is still only a
// cheap pre-ranking, not the final matcher.
export function rankPlausibleCandidates<T extends { title: string; brand: string | null }>(
  vizaje: { brand: string; name: string },
  results: T[],
): (T & { prefilterSimilarity: number })[] {
  const vizajeName = stripConcentrationTokens(cleanVizajeName(vizaje.name).name);
  const normalizedVizajeName = normalizeName(vizajeName);

  const ranked: (T & { prefilterSimilarity: number })[] = [];

  for (const result of results) {
    if (!result.brand) continue;
    if (canonicalBrand(vizaje.brand) !== canonicalBrand(result.brand)) continue;

    const prefilterSimilarity = nameSimilarity(
      normalizedVizajeName,
      normalizeName(stripConcentrationTokens(result.title)),
    );

    if (prefilterSimilarity <= 0) continue;

    ranked.push({ ...result, prefilterSimilarity });
  }

  return ranked.sort((a, b) => b.prefilterSimilarity - a.prefilterSimilarity);
}
