import { Module } from '@nestjs/common';

import { CompetitorsModule } from '../competitors/competitors.module';
import { MatchingModule } from '../matching/matching.module';
import { PolicyModule } from '../policy/policy.module';
import { AiReviewController } from './ai-review.controller';
import { AiReviewService } from './ai-review.service';
import { DeepseekReviewerService } from './deepseek-reviewer.service';
import { DiscoveryAiReviewService } from './discovery-ai-review.service';

// CompetitorsModule is imported ONLY for DiscoveryStateService (recordMatched/
// recordNoMatch) - no circular dependency, since CompetitorsModule itself
// never imports AiModule (the discovery worker consumes
// DiscoveryAiReviewService the other way around - see jobs.module.ts).
@Module({
	imports: [PolicyModule, MatchingModule, CompetitorsModule],
	controllers: [AiReviewController],
	providers: [DeepseekReviewerService, DiscoveryAiReviewService, AiReviewService],
	exports: [DeepseekReviewerService, DiscoveryAiReviewService, AiReviewService]
})
export class AiModule {}
