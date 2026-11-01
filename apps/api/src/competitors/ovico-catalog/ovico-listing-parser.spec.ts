import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseOvicoListingPage } from './ovico-listing-parser';

// Real saved https://ovico.md/ru/armani response (browser DevTools "Save
// response as", 2026-11-01), not a hand-built fixture - see
// ovico-listing-parser.ts's file-level comment for the structural facts
// this test asserts against.
const ARMANI_HTML = readFileSync(
  join(__dirname, '../__fixtures__/ovico-armani-brand-page.html'),
  'utf-8',
);

describe('parseOvicoListingPage', () => {
  it('parses every real product card, deduped by external id', () => {
    const products = parseOvicoListingPage(ARMANI_HTML);

    // The raw markup has 62 ".product-card" occurrences but some products
    // (e.g. a bestsellers carousel) appear twice; dedup by external id
    // (the Magento product entity id) collapses that down.
    expect(products.length).toBeGreaterThan(50);
    expect(products.length).toBeLessThanOrEqual(62);

    const ids = products.map((p) => p.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('extracts the external id from the wishlist form input, not the URL slug', () => {
    const products = parseOvicoListingPage(ARMANI_HTML);

    const iWill = products.find((p) => p.externalId === '23474');
    expect(iWill).toBeDefined();
    expect(iWill?.name).toBe('I Will');
    expect(iWill?.url).toBe('https://ovico.md/ru/armani-i-will-lf704600-comb');
    expect(iWill?.concentration).toBe('Парфюмерная вода');
    expect(iWill?.price).toBe(2100);
    expect(iWill?.isApproximatePrice).toBe(false);
  });

  it('flags an "от" (from)-prefixed price as approximate and still extracts the lowest price', () => {
    const products = parseOvicoListingPage(ARMANI_HTML);

    const emporioHe = products.find((p) => p.externalId === '22312');
    expect(emporioHe).toBeDefined();
    expect(emporioHe?.name).toBe('Emporio Armani He');
    expect(emporioHe?.isApproximatePrice).toBe(true);
    expect(emporioHe?.price).toBe(1500);
  });

  it('never treats the human-edited URL slug as the external id (confirmed duplicate-slug artifact in the sample)', () => {
    const products = parseOvicoListingPage(ARMANI_HTML);

    // Real artifact found in the sample: a product whose slug literally
    // contains "-kopirovat" (Russian for "copy") - proof the slug is
    // human-managed and not a safe identity key.
    const copy = products.find((p) => p.url.includes('kopirovat'));
    expect(copy).toBeDefined();
    // It still has a clean numeric external id from the wishlist form,
    // independent of the messy slug.
    expect(copy?.externalId).toMatch(/^\d+$/);
  });

  it('extracts a usable https image URL, not a webp srcset candidate', () => {
    const products = parseOvicoListingPage(ARMANI_HTML);

    const iWill = products.find((p) => p.externalId === '23474');
    expect(iWill?.imageUrl).toMatch(/^https:\/\/ovico\.md\/media\/catalog\/product\/cache\//);
    expect(iWill?.imageUrl).not.toMatch(/\.webp$/);
  });

  it('is pure and side-effect free: parsing the same fixture twice gives identical results', () => {
    const first = parseOvicoListingPage(ARMANI_HTML);
    const second = parseOvicoListingPage(ARMANI_HTML);

    expect(second).toEqual(first);
  });

  it('returns an empty list for a page with no product cards', () => {
    expect(parseOvicoListingPage('<html><body>no products here</body></html>')).toEqual([]);
  });
});
