import {
  detectProductType,
  extractConcentration,
  extractShadeCode,
  extractVizajeShadeCode,
  nameSimilarity,
  normalizeName,
  normalizeVolume,
  stripConcentrationTokens,
  volumesMatch,
} from './matching-normalization';
import type { MatchDecision, MatchSignals } from './matching.types';
import { cleanVizajeName } from './vizaje-name-cleanup';

// v1 conservative thresholds - see the Milestone 7 audit for the reasoning.
// Not final; expected to be tuned after evaluating precision on real data.
// UNCHANGED by the targeted-search milestone - only extracted so both
// MatchingService and the targeted-sync services score against the exact
// same numbers.
export const AUTO_NAME_SIMILARITY_THRESHOLD = 0.85;
export const AUTO_NO_DISCRIMINATOR_THRESHOLD = 0.93;
export const AMBIGUOUS_NAME_SIMILARITY_THRESHOLD = 0.6;

export const VOLUME_EXACT_BONUS = 5;
export const SHADE_EXACT_BONUS = 5;
export const CONCENTRATION_AGREE_BONUS = 3;

export type ScoredCandidate = {
  nameSimilarity: number;
  score: number;
  decision: MatchDecision;
  rejectReason: string | null;
  signals: MatchSignals;
};

// Single-candidate scoring core (brand gate NOT included - callers apply
// canonicalBrand equality themselves before or after calling this, since
// bulk preview and single-candidate targeted search build that gate
// differently). Extracted from MatchingService.evaluateCandidate() so it is
// the ONE place this logic lives - reused by:
//   - MatchingService (bulk preview/persist-auto over already-persisted
//     competitor_product_variants rows)
//   - targeted-sync services (a single freshly-parsed, not-yet-persisted
//     candidate, scored BEFORE any competitor_products/variants write)
// Do not duplicate this logic anywhere else.
export function scoreCandidate(
  vizaje: {
    brand: string;
    name: string;
    volume: string | null;
    color: string | null;
  },
  competitor: {
    title: string;
    variantLabel: string | null;
    variantVolume: string | null;
  },
): ScoredCandidate {
  // Name-similarity input only: strip the Vizaje website's "| presentation
  // suffix" (category/gender/concentration metadata, e.g. "Acqua di Gioia |
  // Женская парфюмированная вода") before comparing tokens - it is not part
  // of the actual product-line identity and previously dragged real matches
  // below the AUTO threshold. Concentration/shade/type detection below
  // deliberately still scan the RAW name - they already correctly pick up
  // signal from that same suffix text (e.g. "парфюмированная вода" -> EDP).
  const vizajeCleanedName = cleanVizajeName(vizaje.name).name;
  const vizajeNameNormalized = stripConcentrationTokens(normalizeName(vizajeCleanedName));
  const competitorNameNormalized = stripConcentrationTokens(normalizeName(competitor.title));

  const concentrationVizaje = extractConcentration(vizaje.name);
  const concentrationCompetitor = extractConcentration(competitor.title);
  const concentrationConflict = Boolean(
    concentrationVizaje &&
      concentrationCompetitor &&
      concentrationVizaje !== concentrationCompetitor,
  );
  const concentrationAgree = Boolean(
    concentrationVizaje &&
      concentrationCompetitor &&
      concentrationVizaje === concentrationCompetitor,
  );

  const vizajeVolume = normalizeVolume(vizaje.volume);
  const competitorVolume = normalizeVolume(competitor.variantVolume);
  const volumeBothPresent = Boolean(vizajeVolume && competitorVolume);
  const volumeExactMatch =
    volumeBothPresent && volumesMatch(vizajeVolume, competitorVolume);
  const volumeConflict = volumeBothPresent && !volumeExactMatch;

  const vizajeShade = extractVizajeShadeCode(vizaje.color, vizaje.name);
  const competitorShade = extractShadeCode(competitor.variantLabel);
  const shadeBothPresent = Boolean(vizajeShade && competitorShade);
  const shadeExactMatch = shadeBothPresent && vizajeShade === competitorShade;
  const shadeConflict = shadeBothPresent && !shadeExactMatch;

  const typeVizaje = detectProductType(vizaje.name);
  const typeCompetitor = detectProductType(competitor.title);
  const typeConflict = Boolean(
    typeVizaje && typeCompetitor && typeVizaje !== typeCompetitor,
  );

  const isColorProduct = Boolean(vizajeShade || competitorShade);

  const signals: MatchSignals = {
    brandMatched: true,
    concentrationVizaje,
    concentrationCompetitor,
    concentrationConflict,
    concentrationAgree,
    volumeVizaje: vizajeVolume ? `${vizajeVolume.amount} ${vizajeVolume.unit}` : null,
    volumeCompetitor: competitorVolume
      ? `${competitorVolume.amount} ${competitorVolume.unit}`
      : null,
    volumeConflict,
    volumeExactMatch,
    shadeVizaje: vizajeShade,
    shadeCompetitor: competitorShade,
    shadeConflict,
    shadeExactMatch,
    typeVizaje,
    typeCompetitor,
    typeConflict,
    isColorProduct,
  };

  if (concentrationConflict) {
    return { nameSimilarity: 0, score: 0, decision: 'reject', rejectReason: 'concentration_conflict', signals };
  }
  if (volumeConflict) {
    return { nameSimilarity: 0, score: 0, decision: 'reject', rejectReason: 'volume_mismatch', signals };
  }
  if (shadeConflict) {
    return { nameSimilarity: 0, score: 0, decision: 'reject', rejectReason: 'shade_mismatch', signals };
  }
  if (typeConflict) {
    return { nameSimilarity: 0, score: 0, decision: 'reject', rejectReason: 'type_conflict', signals };
  }

  const similarity = nameSimilarity(vizajeNameNormalized, competitorNameNormalized);

  let score = Math.round(similarity * 100);
  if (volumeExactMatch) score += VOLUME_EXACT_BONUS;
  if (shadeExactMatch) score += SHADE_EXACT_BONUS;
  if (concentrationAgree) score += CONCENTRATION_AGREE_BONUS;
  score = Math.min(100, Math.max(0, score));

  const noDiscriminatorEitherSide =
    !vizajeVolume && !competitorVolume && !vizajeShade && !competitorShade;

  let eligibleForAuto = false;
  if (similarity >= AUTO_NAME_SIMILARITY_THRESHOLD) {
    if (volumeExactMatch || shadeExactMatch) {
      eligibleForAuto = true;
    } else if (noDiscriminatorEitherSide && similarity >= AUTO_NO_DISCRIMINATOR_THRESHOLD) {
      eligibleForAuto = true;
    }
  }

  if (isColorProduct && !shadeExactMatch) {
    eligibleForAuto = false;
  }

  if (eligibleForAuto) {
    return { nameSimilarity: similarity, score, decision: 'auto', rejectReason: null, signals };
  }

  if (similarity >= AMBIGUOUS_NAME_SIMILARITY_THRESHOLD) {
    return { nameSimilarity: similarity, score, decision: 'ambiguous', rejectReason: null, signals };
  }

  return { nameSimilarity: similarity, score, decision: 'reject', rejectReason: 'low_name_similarity', signals };
}
