// MANUAL, EXPLICITLY-GATED script - sends ONE real request to the live
// DeepSeek API and prints the structured response + usage/cost. This is
// the ONLY script in this project that can spend real DeepSeek balance -
// it is NEVER called by the test suite, by any other verify-*.ts script,
// or by any automated process. Run it yourself, deliberately:
//
//   DEEPSEEK_API_KEY=sk-... bun run scripts/verify-deepseek-live.ts
//
// Exits immediately with a clear message (no network call at all) if
// DEEPSEEK_API_KEY is not set - there is no way to accidentally trigger a
// real call by running this without a key in the environment.
import 'reflect-metadata';

import { DeepseekReviewerService } from '../src/ai/deepseek-reviewer.service';
import type { DeepseekReviewInput } from '../src/ai/deepseek-review.types';

const SYNTHETIC_AMBIGUOUS_INPUT: DeepseekReviewInput = {
  vizaje: {
    brand: 'Nivea',
    name: 'Nivea Creme',
    article: 'NIV-CREME-100',
    barcode: '4005808173534',
    volume: '100ml',
    shade: null,
  },
  competitor: {
    title: 'Nivea Creme Original 100 ml',
    brand: 'Nivea',
    variantLabel: 'Original',
    variantVolume: '100ml',
    price: '85.00',
    url: 'https://ovico.md/example-nivea-creme-100ml',
  },
  ruleScore: 74,
  ruleSignals: {
    brandMatched: true,
    concentrationVizaje: null,
    concentrationCompetitor: null,
    concentrationConflict: false,
    concentrationAgree: false,
    volumeVizaje: '100ml',
    volumeCompetitor: '100ml',
    volumeConflict: false,
    volumeExactMatch: true,
    shadeVizaje: null,
    shadeCompetitor: null,
    shadeConflict: false,
    shadeExactMatch: false,
    namedShadeVizaje: null,
    namedShadeCompetitor: null,
    namedShadeConflict: false,
    namedShadeExactMatch: false,
    typeVizaje: 'cream',
    typeCompetitor: 'cream',
    typeConflict: false,
  } as never,
};

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error(
      '[verify-deepseek-live] DEEPSEEK_API_KEY is not set - refusing to run. ' +
        'This script makes a REAL DeepSeek API call and will spend real balance. ' +
        'Set DEEPSEEK_API_KEY explicitly and re-run if you intend that.',
    );
    process.exit(1);
  }

  console.log(`[verify-deepseek-live] sending ONE real request to DeepSeek (model=${process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'})...`);
  console.log('Synthetic input:', JSON.stringify(SYNTHETIC_AMBIGUOUS_INPUT, null, 2));

  const reviewer = new DeepseekReviewerService();
  const result = await reviewer.reviewCandidate(SYNTHETIC_AMBIGUOUS_INPUT);

  console.log();
  console.log('Result:', JSON.stringify(result, null, 2));

  if (result.kind === 'success') {
    console.log();
    console.log(
      `Usage: ${result.usage.promptTokens ?? '?'} prompt + ${result.usage.completionTokens ?? '?'} completion tokens, ` +
        `${result.usage.latencyMs}ms, est. $${result.usage.estimatedCostUsd?.toFixed(6) ?? 'unknown'}`,
    );
  }
}

main().catch(error => {
  console.error('[verify-deepseek-live] FAILED', error);
  process.exit(1);
});
