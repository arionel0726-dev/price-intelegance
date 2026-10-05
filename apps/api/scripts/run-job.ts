import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { MakeupDiscoveryJob } from '../src/jobs/makeup-discovery.job';
import { MakeupRefreshJob } from '../src/jobs/makeup-refresh.job';
import { OvicoDiscoveryJob } from '../src/jobs/ovico-discovery.job';
import { OvicoRefreshJob } from '../src/jobs/ovico-refresh.job';
import { VizajeMasterSyncJob } from '../src/jobs/vizaje-master-sync.job';

// Manual job runner - every scheduled workflow stays runnable outside its
// cron schedule (operations/debugging). Same job class, same lock, same
// envelope as a real scheduled firing - this is not a separate code path.
//
// Usage (from apps/api):
//   bun run scripts/run-job.ts vizaje
//   bun run scripts/run-job.ts makeup-discovery [limit] [--brand="Clarins"] [--in-stock] [--only-unmatched]
//   bun run scripts/run-job.ts makeup-refresh
//   bun run scripts/run-job.ts ovico-discovery [limit] [--brand="Clarins"] [--in-stock] [--only-unmatched]
//   bun run scripts/run-job.ts ovico-refresh
//
// The three discovery flags are only meaningful for makeup-discovery /
// ovico-discovery - see discovery-targets.ts for what each one selects.

const JOB_NAMES = [
  'vizaje',
  'makeup-discovery',
  'makeup-refresh',
  'ovico-discovery',
  'ovico-refresh',
] as const;

type JobName = (typeof JOB_NAMES)[number];

type DiscoveryCliArgs = {
  limit?: number;
  brand?: string;
  inStock: boolean;
  onlyUnmatched?: boolean;
};

// Deliberately permissive about flag position - the required CLI examples
// put the positional limit first and flags after, but there's no reason to
// enforce that ordering.
function parseDiscoveryArgs(rest: string[]): DiscoveryCliArgs {
  const result: DiscoveryCliArgs = { inStock: false };

  for (const arg of rest) {
    if (arg === '--in-stock') {
      result.inStock = true;
      continue;
    }

    if (arg === '--only-unmatched') {
      result.onlyUnmatched = true;
      continue;
    }

    const brandMatch = arg.match(/^--brand=(.*)$/);
    if (brandMatch) {
      result.brand = brandMatch[1].replace(/^["']|["']$/g, '');
      continue;
    }

    if (/^\d+$/.test(arg) && result.limit === undefined) {
      result.limit = Number(arg);
      continue;
    }

    throw new Error(`Unrecognized argument: ${arg}`);
  }

  return result;
}

async function main() {
  const [jobArg, ...rest] = process.argv.slice(2);

  if (!jobArg || !JOB_NAMES.includes(jobArg as JobName)) {
    throw new Error(`Usage: run-job.ts <${JOB_NAMES.join('|')}> [limit] [--brand="..."] [--in-stock] [--only-unmatched]`);
  }

  const job = jobArg as JobName;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    let result: unknown;

    switch (job) {
      case 'vizaje':
        result = await app.get(VizajeMasterSyncJob).run();
        break;
      case 'makeup-discovery': {
        const { limit, brand, inStock, onlyUnmatched } = parseDiscoveryArgs(rest);
        result = await app.get(MakeupDiscoveryJob).run({ limit, brand, inStock, onlyUnmatched });
        break;
      }
      case 'makeup-refresh':
        result = await app.get(MakeupRefreshJob).run();
        break;
      case 'ovico-discovery': {
        const { limit, brand, inStock, onlyUnmatched } = parseDiscoveryArgs(rest);
        result = await app.get(OvicoDiscoveryJob).run({ limit, brand, inStock, onlyUnmatched });
        break;
      }
      case 'ovico-refresh':
        result = await app.get(OvicoRefreshJob).run();
        break;
    }

    console.log('\n[run-job] RESULT');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[run-job] FAILED', error);
    process.exit(1);
  });
