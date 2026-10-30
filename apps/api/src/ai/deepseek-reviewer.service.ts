import {
	DEEPSEEK_API_KEY,
	DEEPSEEK_BASE_URL,
	DEEPSEEK_MAX_ATTEMPTS,
	DEEPSEEK_MODEL,
	DEEPSEEK_REQUEST_TIMEOUT_MS,
	DEEPSEEK_RETRY_BASE_DELAY_MS,
	estimateCostUsd
} from './deepseek.config';
import {
	deepseekReviewOutputSchema,
	type DeepseekReviewInput,
	type DeepseekReviewResult,
	type DeepseekUsage
} from './deepseek-review.types';

// Everything reviewCandidate() needs to actually make a call - defaults to
// the env-driven module constants above (the real NestJS DI path: `new
// DeepseekReviewerService()`, no override), but accepting it as a
// constructor param (rather than reading the module consts directly
// inside the class body) lets a test construct the service with EXACT
// config values of its own choosing, with no dependency on env-var
// timing relative to module import order - see deepseek-reviewer.
// service.spec.ts, which exercises retry/parse-error/timeout behavior
// this way instead of reloading the module per test.
export type DeepseekRuntimeConfig = {
	apiKey: string | null;
	model: string;
	baseUrl: string;
	requestTimeoutMs: number;
	maxAttempts: number;
	retryBaseDelayMs: number;
};

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// Retryable ONLY for network timeout/429/temporary 5xx - never for a
// malformed/unparseable response (that fails fast, see reviewCandidate).
// AI unavailability (disabled, no key, exhausted retries) is never a
// no_match/product-match failure for the caller - it just means "stays
// pending", handled entirely by DiscoveryAiReviewService, not here.
class RetryableHttpError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RetryableHttpError';
	}
}

const SYSTEM_PROMPT = `You are reviewing a candidate product match between a Vizaje-Nica (Moldova) product and a competitor's listing. A deterministic rule engine already scored this pair as ambiguous - not clearly the same product, not clearly different. Decide whether the competitor listing is the SAME product (same brand, product line, and the same variant - volume/shade/concentration where applicable) as the Vizaje product.

Respond with ONLY a JSON object, no markdown, no commentary, matching exactly this shape:
{"verdict": "approve" | "reject", "confidence": <number 0 to 1>, "reason": "<short explanation>", "signals": {"brand"?: string, "productType"?: string, "volume"?: string, "shade"?: string, "concentration"?: string, "variant"?: string}}

"approve" means you are confident this is the same product and variant. "reject" means it is not, or you are not confident enough to say so. Only fill "signals" fields you actually have evidence for from the given data - never invent values.`;

// Deliberately NOT @Injectable() and imports nothing from '@nestjs/common'
// - this sandbox's Jest+Bun setup cannot load that package at all when a
// spec file requires it (the same pre-existing ESM/CJS mismatch that
// already breaks app.controller.spec.ts/products.*.spec.ts, see project
// notes), which would make this service untestable. NestJS's DI container
// instantiates any class listed in a module's `providers` array via plain
// `new`, decorated or not - only a class that itself needs OTHER
// providers injected (via reflected constructor param types) requires
// @Injectable(). This class's constructor takes a single optional, never-
// DI-provided config object, so omitting the decorator changes nothing at
// runtime - verified by the app boot smoke-check in
// verify-milestone3-ai-review.ts.
export class DeepseekReviewerService {
	private readonly config: DeepseekRuntimeConfig;

	constructor(config?: Partial<DeepseekRuntimeConfig>) {
		this.config = {
			apiKey: DEEPSEEK_API_KEY,
			model: DEEPSEEK_MODEL,
			baseUrl: DEEPSEEK_BASE_URL,
			requestTimeoutMs: DEEPSEEK_REQUEST_TIMEOUT_MS,
			maxAttempts: DEEPSEEK_MAX_ATTEMPTS,
			retryBaseDelayMs: DEEPSEEK_RETRY_BASE_DELAY_MS,
			...config
		};
	}

	isConfigured(): boolean {
		return this.config.apiKey !== null && this.config.apiKey.length > 0;
	}

	// Never throws for an expected failure mode - see DeepseekReviewResult.
	// Callers (DiscoveryAiReviewService) are expected to check
	// isConfigured()/app_settings.ai.enabled BEFORE calling this, but this
	// method also re-checks the key itself defensively (a disabled/
	// unconfigured AI must never block or fail discovery).
	async reviewCandidate(input: DeepseekReviewInput): Promise<DeepseekReviewResult> {
		if (!this.isConfigured()) {
			return { kind: 'unavailable', reason: 'no_api_key' };
		}

		const prompt = JSON.stringify(input);
		const startedAt = Date.now();

		let lastError: unknown;

		for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
			try {
				const { content, usage } = await this.callChatCompletion(prompt);
				const latencyMs = Date.now() - startedAt;

				const resolvedUsage: DeepseekUsage = {
					model: this.config.model,
					promptTokens: usage?.prompt_tokens ?? null,
					completionTokens: usage?.completion_tokens ?? null,
					totalTokens: usage?.total_tokens ?? null,
					latencyMs,
					estimatedCostUsd:
						usage?.prompt_tokens != null && usage?.completion_tokens != null
							? estimateCostUsd(usage.prompt_tokens, usage.completion_tokens)
							: null
				};

				return this.parseModelOutput(content, resolvedUsage);
			} catch (error) {
				lastError = error;

				if (!(error instanceof RetryableHttpError) || attempt === this.config.maxAttempts) {
					break;
				}

				console.warn(
					`[DeepseekReviewerService] DeepSeek call failed (attempt ${attempt}/${this.config.maxAttempts}), retrying: ${String(error)}`
				);
				await sleep(this.config.retryBaseDelayMs * attempt);
			}
		}

		const message = lastError instanceof Error ? lastError.message : String(lastError);
		return { kind: 'network_error', message, attempts: this.config.maxAttempts };
	}

	private parseModelOutput(content: string, usage: DeepseekUsage): DeepseekReviewResult {
		let raw: unknown;

		try {
			raw = JSON.parse(content);
		} catch (error) {
			return { kind: 'parse_error', message: `invalid JSON: ${String(error)}`, raw: content, usage };
		}

		const result = deepseekReviewOutputSchema.safeParse(raw);

		if (!result.success) {
			// Strict Zod validation (see deepseek-review.types.ts) - an
			// out-of-range confidence, a missing field, or an unexpected
			// verdict value all land here identically: never clamped,
			// never guessed, the candidate stays pending either way.
			return { kind: 'parse_error', message: result.error.message, raw, usage };
		}

		return { kind: 'success', ...result.data, usage };
	}

	private async callChatCompletion(
		userContent: string
	): Promise<{ content: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined }> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

		try {
			const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.config.apiKey}`
				},
				body: JSON.stringify({
					model: this.config.model,
					messages: [
						{ role: 'system', content: SYSTEM_PROMPT },
						{ role: 'user', content: userContent }
					],
					temperature: 0,
					response_format: { type: 'json_object' }
				}),
				signal: controller.signal
			});

			if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
				throw new RetryableHttpError(`DeepSeek returned HTTP ${response.status}`);
			}

			if (!response.ok) {
				// A 4xx other than 429 (bad request, auth failure, etc.) is
				// NOT retried - retrying the exact same malformed/
				// unauthorized request would just fail identically 3 times.
				throw new Error(`DeepSeek returned HTTP ${response.status}: ${await response.text()}`);
			}

			const body = (await response.json()) as {
				choices?: { message?: { content?: string } }[];
				usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
			};

			const content = body.choices?.[0]?.message?.content;
			if (!content) {
				throw new Error('DeepSeek response had no message content');
			}

			return { content, usage: body.usage };
		} catch (error) {
			if (error instanceof RetryableHttpError) throw error;

			// AbortError (our own timeout) is retryable - everything else
			// thrown above this catch is either already a RetryableHttpError
			// (rethrown as-is) or a non-retryable Error (also rethrown,
			// caught by the outer loop's `!(error instanceof
			// RetryableHttpError)` check, which stops retrying immediately).
			if (error instanceof Error && error.name === 'AbortError') {
				throw new RetryableHttpError(`DeepSeek request timed out after ${this.config.requestTimeoutMs}ms`);
			}

			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}
}
