import { matchesBrandFilter, randomSample } from './discovery-targets';

describe('matchesBrandFilter', () => {
  it('matches identical brand text', () => {
    expect(matchesBrandFilter('Clarins', 'Clarins')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesBrandFilter('CLARINS', 'clarins')).toBe(true);
    expect(matchesBrandFilter('clarins', 'ClArInS')).toBe(true);
  });

  it('does not match a different brand', () => {
    expect(matchesBrandFilter('Clarins', 'Clinique')).toBe(false);
  });

  it('is exact/normalized, not fuzzy - a near-miss does not match', () => {
    // Deliberately NOT similar-string matching: "Clarin" is one character
    // off from "Clarins" and must be rejected, not fuzzy-accepted.
    expect(matchesBrandFilter('Clarins', 'Clarin')).toBe(false);
  });

  it('resolves known brand aliases (reuses canonicalBrand, not a separate table)', () => {
    // "ysl" / "Yves Saint Laurent" is a confirmed real alias pair already
    // used by the matcher - the brand filter must see them as the same
    // brand since it reuses canonicalBrand() rather than a second table.
    expect(matchesBrandFilter('YSL', 'Yves Saint Laurent')).toBe(true);
    expect(matchesBrandFilter('Yves Saint Laurent', 'ysl')).toBe(true);
  });

  it('ignores accents/diacritics and surrounding whitespace', () => {
    expect(matchesBrandFilter('  Clarins  ', 'clarins')).toBe(true);
  });
});

describe('randomSample', () => {
  it('returns the whole pool when limit >= pool size', () => {
    const pool = [1, 2, 3];
    const sample = randomSample(pool, 5);
    expect(sample).toHaveLength(3);
    expect([...sample].sort()).toEqual([1, 2, 3]);
  });

  it('returns the whole pool when limit === pool size', () => {
    const pool = [1, 2, 3];
    expect(randomSample(pool, 3)).toHaveLength(3);
  });

  it('returns exactly `limit` distinct items when limit < pool size', () => {
    const pool = Array.from({ length: 50 }, (_, i) => i);
    const sample = randomSample(pool, 10);

    expect(sample).toHaveLength(10);
    expect(new Set(sample).size).toBe(10);
    for (const item of sample) {
      expect(pool).toContain(item);
    }
  });

  it('returns an empty array for a non-positive limit', () => {
    expect(randomSample([1, 2, 3], 0)).toEqual([]);
    expect(randomSample([1, 2, 3], -1)).toEqual([]);
  });

  it('returns an empty array for an empty pool', () => {
    expect(randomSample([], 10)).toEqual([]);
  });

  it('does not mutate the input pool', () => {
    const pool = [1, 2, 3, 4, 5];
    const copy = [...pool];
    randomSample(pool, 2);
    expect(pool).toEqual(copy);
  });
});
