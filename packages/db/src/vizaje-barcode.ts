// Shared barcode normalization for anything dealing with Vizaje/1C source
// data (JobVN.json). Used by the legacy JSON importer (packages/db/scripts)
// and by the website sync's barcode-enrichment lookup (apps/api).

export type BarcodeResult = { value: string | null; note: string | null }

export function normalizeBarcode(raw: string | null): BarcodeResult {
	if (!raw) return { value: null, note: null }

	let value = raw.trim()

	if (value.length === 0) return { value: null, note: null }

	// Purely numeric after trimming - accept any legacy length (EAN-8, UPC-A,
	// EAN-13, and shorter/longer legacy codes). Do not require EAN-13.
	if (/^\d+$/.test(value)) {
		return { value, note: null }
	}

	// Numeric with formatting spaces inside (e.g. "3 57920 036710 9") - safe to
	// collapse since the result is purely numeric.
	const despaced = value.replace(/\s+/g, '')
	if (/^\d{6,14}$/.test(despaced)) {
		return { value: despaced, note: 'removed internal formatting spaces' }
	}

	// Clean uppercase alphanumeric legacy code (e.g. "A0072041") - looks
	// intentional, keep it.
	if (/^[A-Z0-9]{4,20}$/.test(value)) {
		return { value, note: null }
	}

	// Anything else (embedded non-latin text, garbage) is treated as corrupted.
	return { value: null, note: `discarded unrecognizable value: ${JSON.stringify(raw)}` }
}
