import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { OvicoDiscoveryJob } from '../src/jobs/ovico-discovery.job';
import { OvicoRefreshJob } from '../src/jobs/ovico-refresh.job';

// The job lock is in-process (one JobLockService instance per running Nest
// process - see project notes). Each separate `bun run scripts/run-job.ts`
// invocation boots its OWN process/lock, so testing "invoke the same job
// twice" via two separate CLI calls would NOT exercise the shared lock at
// all. This script instead boots ONE app context (matching how the real
// deployed API server holds ONE JobLockService for every scheduled job) and
// fires two job runs concurrently within it - the representative case.
//
// Test A: same job (OvicoRefreshJob) invoked twice concurrently - second
//         call must resolve immediately with status 'skipped_locked'.
// Test B: two DIFFERENT jobs that share the 'ovico' lock key (discovery +
//         refresh) invoked concurrently - the second must also skip, since
//         they must never run concurrently against the same rate-limited
//         site (see project notes, cross-job overlap prevention).
//
// Run with: bun run scripts/lock-test.ts (from apps/api)

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const ovicoRefresh = app.get(OvicoRefreshJob);
    const ovicoDiscovery = app.get(OvicoDiscoveryJob);

    console.log('\n=== Test A: same job (ovico-refresh) invoked twice concurrently ===');
    const [a1, a2] = await Promise.all([ovicoRefresh.run(), ovicoRefresh.run()]);
    console.log(`  run 1 status: ${a1.status}`);
    console.log(`  run 2 status: ${a2.status}`);
    console.log(
      `  PASS=${(a1.status === 'skipped_locked') !== (a2.status === 'skipped_locked') && [a1.status, a2.status].includes('skipped_locked')}`,
    );

    console.log('\n=== Test B: cross-job same-competitor overlap (ovico-discovery + ovico-refresh) ===');
    const [b1, b2] = await Promise.all([ovicoRefresh.run(), ovicoDiscovery.run(1)]);
    console.log(`  ovico-refresh status: ${b1.status}`);
    console.log(`  ovico-discovery status: ${b2.status}`);
    console.log(
      `  PASS=${(b1.status === 'skipped_locked') !== (b2.status === 'skipped_locked') && [b1.status, b2.status].includes('skipped_locked')}`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[lock-test] FAILED', error);
    process.exit(1);
  });
