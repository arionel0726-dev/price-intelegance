import { extractConcentration } from './matching-normalization';

export type VizajeSex = 'female' | 'male' | 'unisex';

export type CleanedVizajeName = {
  // The product-line name with the "| presentation suffix" removed, if the
  // name had one. Falls back to the raw (trimmed) name otherwise.
  name: string;
  sex: VizajeSex | null;
  concentration: string | null;
  hadPresentationSuffix: boolean;
};

const SEX_MARKERS: [RegExp, VizajeSex][] = [
  [/женск/i, 'female'],
  [/мужск/i, 'male'],
  [/унисекс/i, 'unisex'],
];

// Confirmed pattern from a real-data audit (2026-09-04, ~250+ website-
// confirmed Vizaje names inspected): a "|" in a Vizaje name always separates
// "<Brand + product line>" from a short RU category/gender/concentration
// descriptor - e.g. "Acqua di Gioia | Женская парфюмированная вода",
// "DIVAGE Way To Glow Watery Lip Gloss | Блеск для губ". No double-pipe
// names exist, and every observed suffix is <=6 words and almost entirely
// Cyrillic. This heuristic exists specifically so we do NOT blindly strip
// everything after "|" - only text that actually matches the confirmed
// shape is treated as presentation metadata.
function looksLikePresentationSuffix(suffix: string): boolean {
  if (!suffix) return false;

  const wordCount = suffix.split(/\s+/).filter(Boolean).length;
  if (wordCount === 0 || wordCount > 6) return false;

  const letters = suffix.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;

  const cyrillic = suffix.match(/[Ѐ-ӿ]/g) ?? [];

  return cyrillic.length / letters.length >= 0.8;
}

// Separates a Vizaje website name's real product-line identity from
// presentation metadata the site appends after "|" (category, gender,
// concentration). Read-only / query-time - never mutates the DB. See
// project notes: this fixes a real case where "Acqua di Gioia | Женская
// парфюмированная вода" dragged name-similarity below the AUTO threshold
// purely because of the untranslated suffix, not a real product mismatch.
export function cleanVizajeName(rawName: string): CleanedVizajeName {
  const trimmed = rawName.trim();
  const pipeIndex = trimmed.indexOf('|');

  if (pipeIndex === -1) {
    return { name: trimmed, sex: null, concentration: null, hadPresentationSuffix: false };
  }

  const before = trimmed.slice(0, pipeIndex).trim();
  const after = trimmed.slice(pipeIndex + 1).trim();

  if (!before || !looksLikePresentationSuffix(after)) {
    return { name: trimmed, sex: null, concentration: null, hadPresentationSuffix: false };
  }

  let sex: VizajeSex | null = null;
  for (const [pattern, value] of SEX_MARKERS) {
    if (pattern.test(after)) {
      sex = value;
      break;
    }
  }

  return {
    name: before,
    sex,
    concentration: extractConcentration(after),
    hadPresentationSuffix: true,
  };
}
