import { Injectable } from '@nestjs/common';
import { appSettings, eq } from '@price/db';

import { DatabaseService } from '../database/database.service';

// The ONE place that reads app_settings.ai.* - see Milestone 1's seed
// migration (0008) for why this table exists and why the AI toggle/
// threshold live here (true global business settings) rather than in env
// (operational pacing knobs) or a code constant. Nothing else in the
// codebase reads app_settings yet - this is the first accessor for it.
const AI_ENABLED_KEY = 'ai.enabled';
const AI_AUTO_CONFIRM_THRESHOLD_KEY = 'ai.auto_confirm_threshold';

// Matches the seeded defaults in 0008_milestone1_policy_discovery.sql -
// only used if the row is ever missing (should not happen outside a fresh,
// not-yet-seeded database), never silently substituted for a present but
// malformed value (see getAutoConfirmThreshold below).
const DEFAULT_AI_ENABLED = false;
const DEFAULT_AUTO_CONFIRM_THRESHOLD = 0.9;

@Injectable()
export class AppSettingsService {
	constructor(private readonly database: DatabaseService) {}

	async getAiEnabled(): Promise<boolean> {
		const value = await this.getValue(AI_ENABLED_KEY);
		return typeof value === 'boolean' ? value : DEFAULT_AI_ENABLED;
	}

	// Read fresh on every evaluation (not cached) - this is a kill switch
	// and a confidence bar a human may change at any time; a stale cached
	// value here would mean "disable AI" doesn't actually take effect for
	// whatever is already running in memory.
	async getAutoConfirmThreshold(): Promise<number> {
		const value = await this.getValue(AI_AUTO_CONFIRM_THRESHOLD_KEY);

		if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
			return value;
		}

		return DEFAULT_AUTO_CONFIRM_THRESHOLD;
	}

	private async getValue(key: string): Promise<unknown> {
		const [row] = await this.database.db
			.select({ value: appSettings.value })
			.from(appSettings)
			.where(eq(appSettings.key, key));

		return row?.value;
	}
}
