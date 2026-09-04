// Small, evidence-based normalization helpers for deterministic matching.
// Every rule here traces back to a concrete example found in the real-data
// audit (Milestone 7) - see matching.service.ts for how these compose.

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function stripDiacritics(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

function baseClean(value: string): string {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

// Confirmed by the audit against real Vizaje/MAKEUP data - do not add
// speculative aliases (e.g. "Armani Prive" -> "Armani") without evidence.
const BRAND_ALIASES: Record<string, string> = {
  'd and g': 'dolce and gabbana',
  'dolce and gabbana': 'dolce and gabbana',
  armani: 'giorgio armani',
  'giorgio armani': 'giorgio armani',
};

function normalizeBrandKey(raw: string): string {
  let text = baseClean(raw);
  text = text.replace(/&/g, ' and ');
  // Unicode-aware: strip punctuation/symbols but keep letters from any
  // script (Cyrillic Vizaje descriptions must not be silently deleted -
  // that previously made e.g. "Versace ... дезодорант стик" collapse to
  // "Versace ..." and false-match a perfume).
  text = text.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export function canonicalBrand(raw: string | null): string {
  if (!raw) return '';
  const key = normalizeBrandKey(raw);
  return BRAND_ALIASES[key] ?? key;
}

// ---------------------------------------------------------------------------
// Concentration (EDP / EDT / ...)
// ---------------------------------------------------------------------------

// Longest tokens first so "eau de parfum" matches before a bare "parfum".
// Romanian forms ("apa de toaleta" / "apa de parfum" / "apa de colonie")
// confirmed from real OVICO.md product data (2026-09-04) - written here
// already diacritic-stripped ("ă" -> "a") since matching happens against
// baseClean(), which strips diacritics before this list is checked.
const CONCENTRATION_TOKENS: [string, string][] = [
  ['парфюмированная вода', 'edp'],
  ['парфюмерная вода', 'edp'],
  ['eau de parfum', 'edp'],
  ['apa de parfum', 'edp'],
  ['туалетная вода', 'edt'],
  ['eau de toilette', 'edt'],
  ['apa de toaleta', 'edt'],
  ['eau de cologne', 'cologne'],
  ['apa de colonie', 'cologne'],
  ['одеколон', 'cologne'],
  ['cologne', 'cologne'],
  ['эликсир', 'elixir'],
  ['elixir', 'elixir'],
  ['духи', 'parfum'],
  ['parfum', 'parfum'],
  ['edp', 'edp'],
  ['edt', 'edt'],
];

export function extractConcentration(rawName: string | null): string | null {
  if (!rawName) return null;

  const text = ` ${baseClean(rawName)} `;

  for (const [token, canonical] of CONCENTRATION_TOKENS) {
    if (text.includes(` ${token} `) || text.includes(` ${token}`) || text.includes(`${token} `)) {
      return canonical;
    }
  }

  return null;
}

export function stripConcentrationTokens(rawName: string): string {
  let text = ` ${baseClean(rawName)} `;

  for (const [token] of CONCENTRATION_TOKENS) {
    text = text.split(` ${token} `).join(' ');
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Name
// ---------------------------------------------------------------------------

export function normalizeName(rawName: string | null): string {
  if (!rawName) return '';

  let text = baseClean(rawName);
  text = text.replace(/&/g, ' and ');
  // Unicode-aware: strip punctuation/symbols but keep letters from any
  // script (Cyrillic Vizaje descriptions must not be silently deleted -
  // that previously made e.g. "Versace ... дезодорант стик" collapse to
  // "Versace ..." and false-match a perfume).
  text = text.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

// Token-set (Jaccard) similarity, 0..1. Chosen over a character-level metric
// because the audit's real positive/negative pairs separate cleanly on
// shared-word overlap (e.g. "Versace Versense" vs "Versace Crystal Noir"
// shares only the brand token and scores low, as it should).
export function nameSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection += 1;
  }

  const union = new Set([...tokensA, ...tokensB]).size;

  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export type NormalizedVolume = { amount: number; unit: 'ml' | 'g' };

const VOLUME_UNIT_MAP: Record<string, string> = {
  мл: 'ml',
  ml: 'ml',
  г: 'g',
  гр: 'g',
  gr: 'g',
  g: 'g',
  л: 'l',
  l: 'l',
};

// Multi-pack values ("18 x 1.1 g", "4*7.5 ml", "1 pcs") intentionally return
// null - guessing a single comparable volume for those would be unsafe.
export function normalizeVolume(raw: string | null): NormalizedVolume | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  const match = trimmed.match(
    /^(\d+(?:[.,]\d+)?)\s*(мл|ml|г|гр|gr|g|л|l)?\s*$/i,
  );

  if (!match) return null;

  let amount = parseFloat(match[1]!.replace(',', '.'));
  let unit = VOLUME_UNIT_MAP[match[2]?.toLowerCase() ?? 'ml'] ?? 'ml';

  if (unit === 'l') {
    amount *= 1000;
    unit = 'ml';
  }

  if (unit !== 'ml' && unit !== 'g') return null;

  return { amount, unit };
}

export function volumesMatch(
  a: NormalizedVolume | null,
  b: NormalizedVolume | null,
): boolean {
  if (!a || !b) return false;
  if (a.unit !== b.unit) return false;

  return Math.abs(a.amount - b.amount) < 0.01;
}

// ---------------------------------------------------------------------------
// Shade / color
// ---------------------------------------------------------------------------

// Deliberately conservative: only extracts short, clearly-delimited codes
// (e.g. "02", "02.5", "44", "2C3", "1W2", or the leading code in
// "04 CLARET" / "112 ROSEWOOD"). Never attempts to equate semantic shade
// names across sources (e.g. Vizaje "2C3" vs MAKEUP "Ecru" stays unresolved).
const VOLUME_UNIT_WORDS = new Set(['ml', 'мл', 'g', 'г', 'гр', 'gr', 'l', 'л']);

function looksLikeVolumeUnit(word: string): boolean {
  return VOLUME_UNIT_WORDS.has(word.toLowerCase());
}

export function extractShadeCode(raw: string | null): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Whole string is a bare numeric code (e.g. "02", "02.5", "44").
  if (/^\d{1,3}(?:[.,]\d+)?$/.test(trimmed)) {
    return trimmed.replace(',', '.').toUpperCase();
  }

  // Whole string is a short alphanumeric code (e.g. "2C3", "1W2") - guarded
  // against a volume glued to its unit with no space (e.g. "50ml").
  const alnumMatch = trimmed.match(/^([0-9]{1,2})([A-Za-z]{1,3})([0-9]{0,2})$/);
  if (alnumMatch && !looksLikeVolumeUnit(alnumMatch[2]!)) {
    return trimmed.toUpperCase();
  }

  // A leading numeric code before a word (e.g. "04 CLARET" -> "04") - but
  // not when that word is a volume unit (e.g. "100 ml" is not a shade).
  const leading = trimmed.match(/^(\d{1,3}(?:[.,]\d+)?)\s+(\S+)/);
  if (leading) {
    const nextWord = leading[2]!.replace(/[^a-zA-Zа-яА-Я]/g, '');
    if (!looksLikeVolumeUnit(nextWord)) {
      return leading[1]!.replace(',', '.').toUpperCase();
    }
  }

  return null;
}

// Vizaje sometimes embeds the shade code in `name` instead of `color`
// (e.g. "ROUGE ALLURE VELVET INTENSE 45 3,5g" -> "45", color is empty).
export function extractVizajeShadeCode(
  color: string | null,
  name: string,
): string | null {
  const fromColor = extractShadeCode(color);
  if (fromColor) return fromColor;

  const embedded = name.match(
    /\s(\d{1,3})\s+\d+(?:[.,]\d+)?\s*(?:g|ml|мл|г)\s*$/i,
  );

  if (embedded) {
    return embedded[1]!.replace(',', '.').toUpperCase();
  }

  return null;
}

// ---------------------------------------------------------------------------
// Product type conflict detector
// ---------------------------------------------------------------------------

// Small and evidence-based: only the types that showed up as a real risk
// during the audit (e.g. Clinique "Chubby Lash Mascara" vs "Chubby Stick
// Contour"). Not a general cosmetics ontology.
const PRODUCT_TYPE_TOKENS: [string, string][] = [
  ['mascara', 'mascara'],
  ['тушь', 'mascara'],
  ['lipstick', 'lipstick'],
  ['ruj', 'lipstick'],
  ['помада', 'lipstick'],
  ['foundation', 'foundation'],
  ['fond de ten', 'foundation'],
  ['тональн', 'foundation'],
  ['primer', 'primer'],
  ['база под макияж', 'primer'],
  ['база для макияжа', 'primer'],
  ['serum', 'serum'],
  ['сыворотка', 'serum'],
  ['cream', 'cream'],
  ['крем', 'cream'],
  ['contour', 'contour'],
  ['контур', 'contour'],
  // Real audit risk: fragrance brand-extension body care (deodorant,
  // lotion, shower gel) shares brand + fragrance-line name with the actual
  // perfume and can otherwise look like a strong name match.
  ['deodorant', 'deodorant'],
  ['дезодорант', 'deodorant'],
  ['body lotion', 'body_care'],
  ['лосьон для тела', 'body_care'],
  ['shower gel', 'body_care'],
  ['гель для душа', 'body_care'],
];

export function detectProductType(rawText: string | null): string | null {
  if (!rawText) return null;

  const text = baseClean(rawText);

  for (const [token, canonical] of PRODUCT_TYPE_TOKENS) {
    if (text.includes(token)) return canonical;
  }

  return null;
}
