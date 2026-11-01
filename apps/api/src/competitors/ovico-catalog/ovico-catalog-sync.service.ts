import { Injectable, NotFoundException } from '@nestjs/common';

import { catalogSyncRuns, competitorBrandSources, competitors, eq } from '@price/db';

import { DatabaseService } from '../../database/database.service';
import { requestOvicoBrandPageHtml } from '../parser-client';
import { OvicoCatalogPersistenceService } from './ovico-catalog-persistence.service';
import { parseOvicoListingPage } from './ovico-listing-parser';

export type CatalogSyncResult = {
	runId: number;
	status: 'completed' | 'failed';
	pagesProcessed: number;
	discovered: number;
	inserted: number;
	updated: number;
	skipped: number;
	errorCount: number;
	errorSummary: string | null;
};

// Catalog Ingestion v1 (OVICO) - crawlBrandSource is the adapter's single
// entry point: given one confirmed competitor_brand_sources row, fetch its
// listing page, parse it, upsert every product, and record a
// catalog_sync_runs row end to end. Deliberately separate from
// OvicoSyncService (the existing per-SKU search/discovery sync) - no
// per-SKU claim/lease/heartbeat model, no job_runs involvement; see the
// schema comment on catalog_sync_runs for why.
@Injectable()
export class OvicoCatalogSyncService {
	private readonly parserUrl = process.env.PARSER_URL ?? 'http://localhost:8000'

	constructor(
		private readonly database: DatabaseService,
		private readonly persistence: OvicoCatalogPersistenceService
	) {}

	async crawlBrandSource(brandSourceId: number): Promise<CatalogSyncResult> {
		const db = this.database.db

		const [source] = await db
			.select()
			.from(competitorBrandSources)
			.where(eq(competitorBrandSources.id, brandSourceId))
			.limit(1)

		if (!source) {
			throw new NotFoundException(`No competitor_brand_sources row with id ${brandSourceId}`)
		}

		const [run] = await db
			.insert(catalogSyncRuns)
			.values({
				competitorId: source.competitorId,
				brandSourceId: source.id,
				status: 'running'
			})
			.returning()

		try {
			const html = await requestOvicoBrandPageHtml(this.parserUrl, source.sourceUrl)
			const parsedProducts = parseOvicoListingPage(html)

			let inserted = 0
			let updated = 0
			let skipped = 0

			for (const parsed of parsedProducts) {
				if (!parsed.name || parsed.price == null) {
					// Conservative: a card we couldn't get a usable
					// name/price from is skipped rather than persisted with
					// a guessed value - matches the milestone's "do not
					// guess" instruction.
					skipped += 1
					continue
				}

				const { outcome } = await this.persistence.upsertProduct(
					source.competitorId,
					source.brandId,
					parsed
				)

				if (outcome === 'inserted') inserted += 1
				else updated += 1
			}

			const now = new Date()

			await db
				.update(catalogSyncRuns)
				.set({
					status: 'completed',
					pagesProcessed: 1,
					discovered: parsedProducts.length,
					inserted,
					updated,
					skipped,
					finishedAt: now
				})
				.where(eq(catalogSyncRuns.id, run.id))

			await db
				.update(competitorBrandSources)
				.set({
					lastSyncedAt: now,
					lastSyncStatus: 'completed',
					lastSyncError: null,
					updatedAt: now
				})
				.where(eq(competitorBrandSources.id, source.id))

			return {
				runId: run.id,
				status: 'completed',
				pagesProcessed: 1,
				discovered: parsedProducts.length,
				inserted,
				updated,
				skipped,
				errorCount: 0,
				errorSummary: null
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			const now = new Date()

			// A failed run leaves whatever products already got upserted in
			// this attempt in place (no "replace entire catalog"
			// transaction, no rollback of already-persisted rows) - matches
			// the milestone's "each brand sync must be resumable/idempotent,
			// a rerun can safely repeat" requirement: a rerun just upserts
			// the same rows again.
			await db
				.update(catalogSyncRuns)
				.set({
					status: 'failed',
					errorCount: 1,
					errorSummary: message,
					finishedAt: now
				})
				.where(eq(catalogSyncRuns.id, run.id))

			await db
				.update(competitorBrandSources)
				.set({
					lastSyncedAt: now,
					lastSyncStatus: 'failed',
					lastSyncError: message,
					updatedAt: now
				})
				.where(eq(competitorBrandSources.id, source.id))

			return {
				runId: run.id,
				status: 'failed',
				pagesProcessed: 0,
				discovered: 0,
				inserted: 0,
				updated: 0,
				skipped: 0,
				errorCount: 1,
				errorSummary: message
			}
		}
	}

	// Resolves the OVICO `competitors` row by domain, same lookup pattern as
	// OvicoSyncService/ovico-refresh.service.ts - never hardcodes an id.
	async getOvicoCompetitorId(): Promise<number> {
		const [competitor] = await this.database.db
			.select({ id: competitors.id })
			.from(competitors)
			.where(eq(competitors.domain, 'ovico.md'))
			.limit(1)

		if (!competitor) {
			throw new NotFoundException('OVICO competitor row not found (domain=ovico.md)')
		}

		return competitor.id
	}
}
