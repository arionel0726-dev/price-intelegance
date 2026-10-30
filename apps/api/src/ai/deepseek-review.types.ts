import { z } from 'zod';

import type { MatchSignals } from '../matching/matching.types';

// --- Input sent to DeepSeek (Milestone 3 spec, section 2) ----------------
// No raw HTML, ever. Only fields actually present on the source rows -
// never invented/defaulted. The Vizaje/competitor shapes are deliberately
// NOT the full products/competitorProductVariants rows - just the subset
// the brief calls out, so a future column addition to those tables never
// silently leaks into the prompt.
export type DeepseekReviewVizajeInput = {
	brand: string;
	name: string;
	article: string | null;
	barcode: string | null;
	volume: string | null;
	// Mapped from products.color - this schema has no separate
	// "concentration"/"shade"/"variant" column (confirmed by reading
	// packages/db/src/schema.ts), and the rest of this codebase already
	// treats `color` as the shade-equivalent field for cosmetics (see
	// apps/web's product detail page, which labels it "Shade"). Renamed
	// here to match the vocabulary the brief uses, not a new/invented
	// value. `concentration`/`variant` are omitted entirely - there is no
	// source field for either.
	shade: string | null;
};

export type DeepseekReviewCompetitorInput = {
	title: string;
	brand: string | null;
	variantLabel: string | null;
	variantVolume: string | null;
	price: string | null;
	url: string;
};

export type DeepseekReviewInput = {
	vizaje: DeepseekReviewVizajeInput;
	competitor: DeepseekReviewCompetitorInput;
	// Deterministic context already computed and stored on the
	// discovery_candidates row at ambiguous-detection time - reused
	// verbatim, never recomputed (see candidate-scoring.ts, the single
	// source of truth for ruleScore/ruleSignals).
	ruleScore: number;
	ruleSignals: MatchSignals;
};

// --- Output expected FROM DeepSeek (Milestone 3 spec, section 3) --------
// Strict: confidence outside [0,1] is a VALIDATION FAILURE (parse_error),
// never silently clamped. Clamping would hide a misbehaving/miscalibrated
// model behind a plausible-looking number; failing fast and leaving the
// candidate 'pending' is the safer default for a decision that can
// auto-write a match. This is a deliberate, documented choice - see
// DeepseekReviewerService.
const signalsSchema = z
	.object({
		brand: z.string().optional(),
		productType: z.string().optional(),
		volume: z.string().optional(),
		shade: z.string().optional(),
		concentration: z.string().optional(),
		variant: z.string().optional()
	})
	.strict();

export const deepseekReviewOutputSchema = z
	.object({
		verdict: z.enum(['approve', 'reject']),
		confidence: z.number().min(0).max(1),
		reason: z.string().min(1),
		signals: signalsSchema.optional().default({})
	})
	.strict();

export type DeepseekReviewOutput = z.infer<typeof deepseekReviewOutputSchema>;

export type DeepseekUsage = {
	model: string;
	promptTokens: number | null;
	completionTokens: number | null;
	totalTokens: number | null;
	latencyMs: number;
	estimatedCostUsd: number | null;
};

// Discriminated result - DeepseekReviewerService never throws for an
// expected failure mode (disabled, no key, timeout/network, malformed
// response); it returns one of these, and the caller decides what to
// persist. Only a genuinely unexpected programming error throws.
export type DeepseekReviewResult =
	| { kind: 'unavailable'; reason: 'ai_disabled' | 'no_api_key' }
	| ({ kind: 'success' } & DeepseekReviewOutput & { usage: DeepseekUsage })
	| { kind: 'parse_error'; message: string; raw: unknown; usage: DeepseekUsage | null }
	| { kind: 'network_error'; message: string; attempts: number };
