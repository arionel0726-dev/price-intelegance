import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';

import { AppSettingsService } from '../policy/app-settings.service';

class AiSettingsPatchBody {
	enabled?: boolean;
	// UI may collect this as a percentage, but the wire contract is strict:
	// the underlying 0-1 decimal, validated and rejected out of range -
	// never clamped (brief: "validate and store the underlying 0-1 decimal
	// strictly - reject out-of-range, don't clamp").
	autoConfirmThreshold?: number;
}

// Protected by the global AuthGuard like every other controller.
@Controller('admin/settings')
export class AdminSettingsController {
	constructor(private readonly appSettings: AppSettingsService) {}

	// Never exposes DEEPSEEK_API_KEY or any provider secret - this response
	// is built from exactly the fields below, nothing read from
	// process.env.DEEPSEEK_API_KEY ever enters it.
	@Get()
	async get() {
		const [enabled, autoConfirmThreshold] = await Promise.all([
			this.appSettings.getAiEnabled(),
			this.appSettings.getAutoConfirmThreshold(),
		]);

		return {
			ai: { enabled, autoConfirmThreshold },
			// Read-only operational visibility - env-derived pacing/safety
			// knobs, NOT editable through this endpoint (see PATCH below,
			// which only ever touches ai.*). These are operational constants
			// per the project's established app_settings-vs-env split, not
			// business settings - deliberately excludes scoring thresholds,
			// normalization aliases, hard guards, search-query internals and
			// parser settings, none of which belong in Admin.
			operational: {
				discoveryNoMatchRetryDays: Number(process.env.DISCOVERY_NO_MATCH_RETRY_DAYS ?? 7),
				discoveryErrorRetryHours: Number(process.env.DISCOVERY_ERROR_RETRY_HOURS ?? 24),
				productBudgetPresetsSeconds: [60, 180, 300, 600],
				discoveryHeartbeatIntervalMs: Number(process.env.DISCOVERY_HEARTBEAT_INTERVAL_MS ?? 20_000),
				discoveryLeaseStaleMs: Number(process.env.DISCOVERY_LEASE_STALE_MS ?? 75_000),
				makeupMaxSearchErrorRatio: Number(process.env.MAKEUP_MAX_SEARCH_ERROR_RATIO ?? 0.1),
				makeupMaxDeferredRatio: Number(process.env.MAKEUP_MAX_DEFERRED_RATIO ?? 0.3),
				makeupMaxCooldownEventsPerRun: Number(process.env.MAKEUP_MAX_COOLDOWN_EVENTS_PER_RUN ?? 2),
				discoverySafetyMinSample: Number(process.env.DISCOVERY_SAFETY_MIN_SAMPLE ?? 10),
			},
		};
	}

	@Patch('ai')
	async patchAi(@Body() body: AiSettingsPatchBody) {
		if (body.autoConfirmThreshold !== undefined) {
			if (
				typeof body.autoConfirmThreshold !== 'number' ||
				!Number.isFinite(body.autoConfirmThreshold) ||
				body.autoConfirmThreshold < 0 ||
				body.autoConfirmThreshold > 1
			) {
				throw new BadRequestException('autoConfirmThreshold must be a number between 0 and 1 (inclusive)');
			}
			await this.appSettings.setAutoConfirmThreshold(body.autoConfirmThreshold);
		}

		if (body.enabled !== undefined) {
			if (typeof body.enabled !== 'boolean') {
				throw new BadRequestException('enabled must be a boolean');
			}
			await this.appSettings.setAiEnabled(body.enabled);
		}

		const [enabled, autoConfirmThreshold] = await Promise.all([
			this.appSettings.getAiEnabled(),
			this.appSettings.getAutoConfirmThreshold(),
		]);

		return { enabled, autoConfirmThreshold };
	}
}
