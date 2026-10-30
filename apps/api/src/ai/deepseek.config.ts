// DeepSeek API configuration - env-overridable, same convention as the
// other operational knobs in this project (MAKEUP_*, DISCOVERY_*). The key
// itself is NEVER hardcoded or given a default - an absent key means AI
// review is unavailable, not a fallback credential.
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? null;

// deepseek-chat (DeepSeek-V3) is the general-purpose, cheaper, non-
// reasoning model - this is a structured-output classification task
// (approve/reject + a short justification), not a task that benefits from
// deepseek-reasoner's extended chain-of-thought, so -chat is the sane
// default. Override via env if that changes.
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

export const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com';

export const DEEPSEEK_REQUEST_TIMEOUT_MS = Number(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS ?? 30_000);

// Bounded retry - ONLY for network timeout/429/temporary 5xx (see
// deepseek-reviewer.service.ts). A malformed/unparseable response is never
// retried - it fails fast to 'pending'.
export const DEEPSEEK_MAX_ATTEMPTS = Number(process.env.DEEPSEEK_MAX_ATTEMPTS ?? 3);
export const DEEPSEEK_RETRY_BASE_DELAY_MS = Number(process.env.DEEPSEEK_RETRY_BASE_DELAY_MS ?? 500);

// --- Cost estimation (isolated from decision logic on purpose) ----------
// A clearly-labeled ESTIMATE, not a billed figure - DeepSeek's real
// pricing can change or vary by cache-hit state, which this project has no
// way to observe per call. Configurable via env instead of hardcoded in
// DiscoveryAiReviewService/DeepseekReviewerService, so updating it is a
// config change, never a business-logic edit. Defaults reflect
// deepseek-chat's published per-million-token USD pricing as of this
// milestone (cache-miss input / output) - update here, nowhere else, if
// DeepSeek's pricing changes.
export const DEEPSEEK_INPUT_PRICE_PER_MILLION_TOKENS_USD = Number(
	process.env.DEEPSEEK_INPUT_PRICE_PER_MILLION_TOKENS_USD ?? 0.27
);
export const DEEPSEEK_OUTPUT_PRICE_PER_MILLION_TOKENS_USD = Number(
	process.env.DEEPSEEK_OUTPUT_PRICE_PER_MILLION_TOKENS_USD ?? 1.1
);

// DiscoveryAiReviewService.processPendingBatch()'s claim lease - same
// shape as job_runs.heartbeatAt/DISCOVERY_LEASE_STALE_MS: a claim
// (ai_processing_at) older than this is treated as abandoned (a crashed/
// killed batch run) and reclaimable by a later call.
export const AI_REVIEW_PROCESSING_LEASE_MS = Number(process.env.AI_REVIEW_PROCESSING_LEASE_MS ?? 5 * 60 * 1000);

export function estimateCostUsd(promptTokens: number, completionTokens: number): number {
	const inputCost = (promptTokens / 1_000_000) * DEEPSEEK_INPUT_PRICE_PER_MILLION_TOKENS_USD;
	const outputCost = (completionTokens / 1_000_000) * DEEPSEEK_OUTPUT_PRICE_PER_MILLION_TOKENS_USD;

	return inputCost + outputCost;
}
