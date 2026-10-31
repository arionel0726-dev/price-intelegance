import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AdminPlaceholdersService } from './admin-placeholders.service';

class AddPlaceholderBody {
	imageUrl!: string;
	note?: string | null;
}

class UpdatePlaceholderBody {
	note?: string | null;
}

// Protected by the global AuthGuard like every other controller.
@Controller('admin/placeholders')
export class AdminPlaceholdersController {
	constructor(private readonly placeholders: AdminPlaceholdersService) {}

	@Get()
	list() {
		return this.placeholders.list();
	}

	// Read-only diagnostic (never auto-registers) - threshold is an
	// explicit required query param, never a silently hardcoded business
	// rule.
	@Get('candidates')
	candidates(@Query('threshold') threshold?: string) {
		const parsed = threshold ? Number(threshold) : NaN;
		if (!Number.isInteger(parsed) || parsed < 2) {
			throw new BadRequestException('threshold must be an integer >= 2');
		}
		return this.placeholders.candidates(parsed);
	}

	@Post()
	add(@Body() body: AddPlaceholderBody, @Req() req: Request) {
		return this.placeholders.add(body.imageUrl, body.note ?? null, confirmedByFromRequest(req));
	}

	@Patch(':url')
	update(@Param('url') url: string, @Body() body: UpdatePlaceholderBody) {
		return this.placeholders.updateNote(url, body.note ?? null);
	}

	@Delete(':url')
	remove(@Param('url') url: string) {
		return this.placeholders.remove(url);
	}
}

// Same shared-account actor convention as M3's reviewedBy - see
// admin-products.controller.ts's actorFromRequest.
function confirmedByFromRequest(req: Request): string | null {
	const session = (req as Request & { session?: { email: string } }).session;
	return session?.email ?? null;
}
