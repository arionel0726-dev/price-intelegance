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
//   bun run scripts/run-job.ts makeup-discovery [limit]
//   bun run scripts/run-job.ts makeup-refresh
//   bun run scripts/run-job.ts ovico-discovery [limit]
//   bun run scripts/run-job.ts ovico-refresh

const JOB_NAMES = [
  'vizaje',
  'makeup-discovery',
  'makeup-refresh',
  'ovico-discovery',
  'ovico-refresh',
] as const;

type JobName = (typeof JOB_NAMES)[number];

async function main() {
  const [jobArg, limitArg] = process.argv.slice(2);

  if (!jobArg || !JOB_NAMES.includes(jobArg as JobName)) {
    throw new Error(`Usage: run-job.ts <${JOB_NAMES.join('|')}> [limit]`);
  }

  const job = jobArg as JobName;
  const limit = limitArg ? Number(limitArg) : undefined;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    let result: unknown;

    switch (job) {
      case 'vizaje':
        result = await app.get(VizajeMasterSyncJob).run();
        break;
      case 'makeup-discovery':
        result = limit !== undefined
          ? await app.get(MakeupDiscoveryJob).run(limit)
          : await app.get(MakeupDiscoveryJob).run();
        break;
      case 'makeup-refresh':
        result = await app.get(MakeupRefreshJob).run();
        break;
      case 'ovico-discovery':
        result = limit !== undefined
          ? await app.get(OvicoDiscoveryJob).run(limit)
          : await app.get(OvicoDiscoveryJob).run();
        break;
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
