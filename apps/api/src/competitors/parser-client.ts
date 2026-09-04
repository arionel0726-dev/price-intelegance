import { BadGatewayException } from '@nestjs/common';

import type {
  BatchParseResult,
  ParsedProduct,
  SearchBatchResponse,
  SearchResponse,
} from './parser-client.types';

// Thin, stateless HTTP calls to the Python parser service. One shared place
// for the request/error-handling shape so competitor-specific sync services
// don't each reimplement it.
export async function requestParsedProduct(
  parserUrl: string,
  path: string,
  url: string,
): Promise<ParsedProduct> {
  const response = await postToParser(parserUrl, path, { url });

  return (await response.json()) as ParsedProduct;
}

export async function requestParsedBatch(
  parserUrl: string,
  path: string,
  categoryUrl: string,
  maxProducts: number | undefined,
): Promise<BatchParseResult> {
  const response = await postToParser(parserUrl, path, {
    url: categoryUrl,
    max_products: maxProducts,
  });

  return (await response.json()) as BatchParseResult;
}

export async function requestSearch(
  parserUrl: string,
  path: string,
  query: string,
  limit: number,
): Promise<SearchResponse> {
  const response = await postToParser(parserUrl, path, { query, limit });

  return (await response.json()) as SearchResponse;
}

// One browser session, many queries - see searchers/makeup.py. Cuts search
// requests from N browser launches to 1 for a whole targeted-sync run,
// which is also what fixed the WAF pushback a naive per-query browser
// launch caused under real volume.
export async function requestSearchBatch(
  parserUrl: string,
  path: string,
  queries: string[],
  limit: number,
): Promise<SearchBatchResponse> {
  const response = await postToParser(parserUrl, path, { queries, limit });

  return (await response.json()) as SearchBatchResponse;
}

async function postToParser(
  parserUrl: string,
  path: string,
  body: unknown,
): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(`${parserUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new BadGatewayException(
      `Failed to reach parser service: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    throw new BadGatewayException(
      `Parser service returned ${response.status}: ${detail}`,
    );
  }

  return response;
}
