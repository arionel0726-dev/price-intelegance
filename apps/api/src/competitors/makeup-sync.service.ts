import { BadGatewayException, Injectable } from '@nestjs/common';

import { CompetitorPersistenceService } from './competitor-persistence.service';
import { requestParsedBatch, requestParsedProduct } from './parser-client';
import type { BatchParseFailure } from './parser-client.types';

const MAKEUP_COMPETITOR = {
  name: 'MAKEUP',
  domain: 'makeup.md',
};

export type MakeupSyncRequest = {
  categoryUrl: string;
  maxProducts?: number;
};

export type MakeupSyncResult = {
  discovered: number;
  attempted: number;
  parserSucceeded: number;
  parserFailed: number;
  persistedProducts: number;
  persistedVariants: number;
  failures: BatchParseFailure[];
};

@Injectable()
export class MakeupSyncService {
  private readonly parserUrl =
    process.env.PARSER_URL ?? 'http://localhost:8000';

  constructor(private readonly persistence: CompetitorPersistenceService) {}

  async sync({
    categoryUrl,
    maxProducts,
  }: MakeupSyncRequest): Promise<MakeupSyncResult> {
    const batch = await requestParsedBatch(
      this.parserUrl,
      '/parse/makeup/batch',
      categoryUrl,
      maxProducts,
    );

    const competitor = await this.persistence.getOrCreateCompetitor(
      MAKEUP_COMPETITOR,
    );

    let persistedProducts = 0;
    let persistedVariants = 0;

    const failures: BatchParseFailure[] = [...batch.failures];

    for (const parsed of batch.products) {
      if (!parsed.external_id) {
        failures.push({
          external_id: null,
          url: parsed.url,
          error: 'Product has no external_id, cannot be persisted',
        });

        continue;
      }

      try {
        const { variantsPersisted } = await this.persistence.persistProduct(
          competitor.id,
          parsed,
        );

        persistedProducts += 1;
        persistedVariants += variantsPersisted;
      } catch (error) {
        failures.push({
          external_id: parsed.external_id,
          url: parsed.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      discovered: batch.discovered,
      attempted: batch.attempted,
      parserSucceeded: batch.succeeded,
      parserFailed: batch.failed,
      persistedProducts,
      persistedVariants,
      failures,
    };
  }

  // Syncs a single product URL through the same persistence path as sync().
  // Useful for re-syncing/backfilling a specific product outside a category crawl.
  async syncProduct(url: string) {
    const parsed = await requestParsedProduct(
      this.parserUrl,
      '/parse/makeup/product',
      url,
    );

    if (!parsed.external_id) {
      throw new BadGatewayException(
        'Parsed product has no external_id, cannot be persisted',
      );
    }

    const competitor = await this.persistence.getOrCreateCompetitor(
      MAKEUP_COMPETITOR,
    );
    const { variantsPersisted } = await this.persistence.persistProduct(
      competitor.id,
      parsed,
    );

    return {
      externalId: parsed.external_id,
      title: parsed.title,
      variantsPersisted,
    };
  }
}
