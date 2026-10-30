import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AiReviewService } from './ai-review.service';

class RejectBody {
	note?: string;
}

// Protected by the global AuthGuard (see auth.module.ts) like every other
// controller in this API - no @Public() here.
@Controller('ai-review')
export class AiReviewController {
	constructor(private readonly aiReview: AiReviewService) {}

	@Get()
	list(
		@Query('page') page?: string,
		@Query('limit') limit?: string,
		@Query('competitor') competitor?: string,
		@Query('reviewStatus') reviewStatus?: string
	) {
		return this.aiReview.list({
			page: page ? Number(page) : 1,
			limit: limit ? Number(limit) : 20,
			competitor,
			reviewStatus
		});
	}

	@Get('usage-summary')
	usageSummary() {
		return this.aiReview.getUsageSummary();
	}

	@Get(':id')
	get(@Param('id', ParseIntPipe) id: number) {
		return this.aiReview.getOrThrow(id);
	}

	@Post(':id/approve')
	approve(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
		return this.aiReview.approve(id, reviewedByFromRequest(req));
	}

	@Post(':id/reject')
	reject(@Param('id', ParseIntPipe) id: number, @Body() body: RejectBody, @Req() req: Request) {
		return this.aiReview.reject(id, reviewedByFromRequest(req), body?.note);
	}
}

// Same convention as AuthController.me() - the single shared account's
// email, attached to the request by AuthGuard as `req.session.email`.
function reviewedByFromRequest(req: Request): string | null {
	const session = (req as Request & { session?: { email: string } }).session;
	return session?.email ?? null;
}
