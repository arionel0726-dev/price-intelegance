import { BadGatewayException, Injectable } from '@nestjs/common';

import { CompetitorPersistenceService } from './competitor-persistence.service';
import { requestParsedBatch, requestParsedProduct } from './parser-client';
import type { BatchParseFailure } from './parser-client.types';

const OVICO_COMPETITOR = {
  name: 'OVICO',
  domain: 'ovico.md',
};

export type OvicoSyncRequest = {
  categoryUrl: string;
  maxProducts?: number;
};

export type OvicoSyncResult = {
  discovered: number;
  attempted: number;
  parserSucceeded: number;
  parserFailed: number;
  persistedProducts: number;
  persistedVariants: number;
  failures: BatchParseFailure[];
};

@Injectable()
export class OvicoSyncService {
  private readonly parserUrl =
    process.env.PARSER_URL ?? 'http://localhost:8000';

  constructor(private readonly persistence: CompetitorPersistenceService) {}

  // OVICO's robots.txt declares Crawl-delay: 30, enforced inside the parser
  // service - a batch sync can legitimately take minutes. Keep max_products
  // small for interactive/dev use; unattended full refreshes are future work.
  async sync({
    categoryUrl,
    maxProducts,
  }: OvicoSyncRequest): Promise<OvicoSyncResult> {
    const batch = await requestParsedBatch(
      this.parserUrl,
      '/parse/ovico/batch',
      categoryUrl,
      maxProducts,
    );

    const competitor = await this.persistence.getOrCreateCompetitor(
      OVICO_COMPETITOR,
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

  async syncProduct(url: string) {
    const parsed = await requestParsedProduct(
      this.parserUrl,
      '/parse/ovico/product',
      url,
    );

    if (!parsed.external_id) {
      throw new BadGatewayException(
        'Parsed product has no external_id, cannot be persisted',
      );
    }

    const competitor = await this.persistence.getOrCreateCompetitor(
      OVICO_COMPETITOR,
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
