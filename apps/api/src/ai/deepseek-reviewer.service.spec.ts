import { DeepseekReviewerService, type DeepseekRuntimeConfig } from './deepseek-reviewer.service';

// Mocks global fetch - never calls the real DeepSeek API. Config is passed
// explicitly via the constructor (see DeepseekRuntimeConfig) rather than
// through env vars, so each test controls exactly the values it needs
// with no dependency on module-import/env-var timing.
function service(overrides: Partial<DeepseekRuntimeConfig> = {}) {
	return new DeepseekReviewerService({
		apiKey: 'test-key',
		model: 'deepseek-chat',
		baseUrl: 'https://deepseek.test',
		requestTimeoutMs: 1000,
		maxAttempts: 3,
		retryBaseDelayMs: 1,
		...overrides
	});
}

const VALID_OUTPUT = { verdict: 'approve', confidence: 0.95, reason: 'same product and volume', signals: { brand: 'Nivea' } };

function fetchOk(body: unknown, usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }) {
	return {
		ok: true,
		status: 200,
		json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }], usage }),
		text: async () => ''
	};
}

function fetchStatus(status: number) {
	return { ok: false, status, json: async () => ({}), text: async () => `error ${status}` };
}

describe('DeepseekReviewerService', () => {
	const originalFetch = global.fetch;

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it('is unavailable (no_api_key) and never calls fetch when no key is configured', async () => {
		const fetchMock = jest.fn();
		global.fetch = fetchMock as never;

		const result = await service({ apiKey: null }).reviewCandidate({} as never);

		expect(result).toEqual({ kind: 'unavailable', reason: 'no_api_key' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('is unavailable (no_api_key) for an empty-string key too', async () => {
		const fetchMock = jest.fn();
		global.fetch = fetchMock as never;

		const result = await service({ apiKey: '' }).reviewCandidate({} as never);

		expect(result).toEqual({ kind: 'unavailable', reason: 'no_api_key' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('returns a success result with usage on a valid response', async () => {
		const fetchMock = jest.fn().mockResolvedValue(fetchOk(VALID_OUTPUT));
		global.fetch = fetchMock as never;

		const result = await service().reviewCandidate({} as never);

		if (result.kind !== 'success') throw new Error(`expected success, got ${result.kind}`);
		expect(result.verdict).toBe('approve');
		expect(result.confidence).toBe(0.95);
		expect(result.usage.promptTokens).toBe(100);
		expect(result.usage.completionTokens).toBe(20);
		expect(result.usage.model).toBe('deepseek-chat');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('treats an out-of-range confidence as a parse_error, never clamps it silently', async () => {
		const fetchMock = jest.fn().mockResolvedValue(fetchOk({ ...VALID_OUTPUT, confidence: 1.4 }));
		global.fetch = fetchMock as never;

		const result = await service().reviewCandidate({} as never);

		expect(result.kind).toBe('parse_error');
		expect(fetchMock).toHaveBeenCalledTimes(1); // never retried for a semantic failure
	});

	it('treats a missing required field as a parse_error with no retry', async () => {
		const fetchMock = jest.fn().mockResolvedValue(fetchOk({ verdict: 'approve' }));
		global.fetch = fetchMock as never;

		const result = await service().reviewCandidate({} as never);

		expect(result.kind).toBe('parse_error');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('treats invalid JSON content as a parse_error with no retry', async () => {
		const fetchMock = jest.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
			text: async () => ''
		});
		global.fetch = fetchMock as never;

		const result = await service().reviewCandidate({} as never);

		expect(result.kind).toBe('parse_error');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('retries a 429 up to maxAttempts, then reports network_error and STOPS', async () => {
		const fetchMock = jest.fn().mockResolvedValue(fetchStatus(429));
		global.fetch = fetchMock as never;

		const result = await service({ maxAttempts: 3 }).reviewCandidate({} as never);

		expect(result).toMatchObject({ kind: 'network_error', attempts: 3 });
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('retries a 503 the same way as a 429', async () => {
		const fetchMock = jest.fn().mockResolvedValue(fetchStatus(503));
		global.fetch = fetchMock as never;

		const result = await service({ maxAttempts: 2 }).reviewCandidate({} as never);

		expect(result.kind).toBe('network_error');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does NOT retry a non-retryable 4xx (e.g. 401) - fails fast', async () => {
		const fetchMock = jest.fn().mockResolvedValue(fetchStatus(401));
		global.fetch = fetchMock as never;

		const result = await service({ maxAttempts: 3 }).reviewCandidate({} as never);

		expect(result.kind).toBe('network_error');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('recovers on a later attempt if an earlier one was retryable', async () => {
		const fetchMock = jest
			.fn()
			.mockResolvedValueOnce(fetchStatus(429))
			.mockResolvedValueOnce(fetchOk(VALID_OUTPUT));
		global.fetch = fetchMock as never;

		const result = await service({ maxAttempts: 3 }).reviewCandidate({} as never);

		expect(result.kind).toBe('success');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('a timeout (AbortError) is retryable, same as 429/5xx', async () => {
		const fetchMock = jest.fn().mockImplementation(() => {
			const error = new Error('aborted');
			error.name = 'AbortError';
			return Promise.reject(error);
		});
		global.fetch = fetchMock as never;

		const result = await service({ maxAttempts: 2, requestTimeoutMs: 50 }).reviewCandidate({} as never);

		expect(result.kind).toBe('network_error');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('isConfigured() reflects whether a usable key is present', () => {
		expect(service({ apiKey: 'x' }).isConfigured()).toBe(true);
		expect(service({ apiKey: null }).isConfigured()).toBe(false);
		expect(service({ apiKey: '' }).isConfigured()).toBe(false);
	});
});
