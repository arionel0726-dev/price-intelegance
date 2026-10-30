import 'reflect-metadata';

import {
  and,
  brands,
  competitorProductVariants,
  competitorProducts,
  competitors,
  discoveryAttempts,
  eq,
  ilike,
  inArray,
  jobEvents,
  jobRuns,
  matches,
  products,
} from '@price/db';

import { CompetitorPersistenceService } from '../src/competitors/competitor-persistence.service';
import { DiscoveryStateService } from '../src/competitors/discovery-state.service';
import { selectNextContinuousTarget, type DiscoveryTarget } from '../src/competitors/discovery-targets';
import { MakeupCooldownTracker } from '../src/competitors/makeup-cooldown-tracker';
import { canonicalBrand } from '../src/matching/matching-normalization';
import { MatchingService } from '../src/matching/matching.service';
import { SkuBudget, type SkuOutcome } from '../src/competitors/sku-discovery.types';
import { DatabaseService } from '../src/database/database.service';
import { DiscoveryJobsService } from '../src/jobs/discovery-jobs.service';
import { DiscoveryWorkerService } from '../src/jobs/discovery-worker.service';
import type { AppSettingsService } from '../src/policy/app-settings.service';
import type { DiscoveryAiReviewService } from '../src/ai/discovery-ai-review.service';

// Milestone 2 (DB-backed discovery job execution) integration verification
// - same real-Postgres, synthetic-prefix, cleaned-up-in-finally convention
// as verify-milestone1-policy-discovery.ts. Builds DatabaseService/
// DiscoveryJobsService/DiscoveryStateService/CompetitorPersistenceService
// directly (same manual-construction pattern already used by
// verify-catalog-price-safety.ts), and builds DiscoveryWorkerService with
// FAKE Makeup/Ovico sku-discovery services so this never touches the real
// network/parser - see the Fake*SkuDiscoveryService classes below. Private
// methods on DiscoveryWorkerService (claim/reconcile/runJob/startHeartbeat/
// stopHeartbeat) are accessed via `as any` - acceptable for a verification
// script exercising internal mechanics directly, not a public API contract.
//
// Run with (from apps/api):
//   DATABASE_URL=postgresql://price:price@localhost:5432/price \
//   DISCOVERY_HEARTBEAT_INTERVAL_MS=150 DISCOVERY_LEASE_STALE_MS=400 \
//   MAKEUP_COOLDOWN_WAIT_MS=50 MAKEUP_COOLDOWN_THRESHOLD=2 \
//   MAKEUP_MAX_COOLDOWN_EVENTS_PER_RUN=2 DISCOVERY_SAFETY_MIN_SAMPLE=4 \
//   bun run scripts/verify-milestone2-worker.ts
//
// DISCOVERY_SAFETY_MIN_SAMPLE is lowered (from its production default of
// 10) purely so the search-error-ratio test below can trip within the
// handful of synthetic MAKEUP products this script creates - a product
// that's actually been attempted (even a 'deferred' one, via
// recordProcessing) is excluded from reselection for the rest of THIS
// job's lifetime, so there's no way to manufacture 10+ attempts against
// only 6 products without either lowering this floor or adding many more
// synthetic products; lowering it is the smaller change and has no
// bearing on any other check in this script (none of them assert an
// exact minSample-dependent boundary).

const PREFIX = 'test-m2-';

let failures = 0;
function check(label: string, condition: boolean): void {
  const status = condition ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${label}`);
  if (!condition) failures += 1;
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FakeOvicoSkuDiscoveryService {
  calls: DiscoveryTarget[] = [];

  constructor(
    private readonly database: DatabaseService,
    private readonly discoveryState: DiscoveryStateService,
    private readonly behavior: (callIndex: number, vizaje: DiscoveryTarget) => Promise<SkuOutcome>,
  ) {}

  async processOne(vizaje: DiscoveryTarget, competitor: { id: number }, jobRunId: number | null): Promise<SkuOutcome> {
    this.calls.push(vizaje);
    const outcome = await this.behavior(this.calls.length, vizaje);

    if (outcome.kind === 'no_match') await this.discoveryState.recordNoMatch(vizaje.id, competitor.id, jobRunId);
    if (outcome.kind === 'error') await this.discoveryState.recordError(vizaje.id, competitor.id, outcome.reason, jobRunId);
    // 'auto' persistence is done directly by the test via raw SQL (needs a
    // real competitor_product_variants row) - see makeAutoOutcome() below.

    // Mirrors the REAL OvicoSkuDiscoveryService.recordTerminalOutcome's
    // job_events emission (Milestone 2 counter/outcome idempotency fix) -
    // this fake stands in for the whole service, so it has to reproduce
    // that part of its contract too, or recomputeCounters() would see no
    // events for these outcomes and every processedCount/autoCount/etc.
    // assertion below would read 0. The atomicity of that write itself is
    // exercised by the real service, not this fake - see the dedicated
    // crash-simulation test further down for that.
    if (jobRunId != null && outcome.kind !== 'deferred') {
      const eventType =
        outcome.kind === 'auto' ? 'product_auto_matched'
        : outcome.kind === 'ambiguous' ? 'product_pending_review'
        : outcome.kind === 'no_match' ? 'product_no_match'
        : 'product_error';
      const data =
        outcome.kind === 'auto' ? { score: outcome.score, matchOutcome: outcome.matchOutcome }
        : outcome.kind === 'ambiguous' ? { score: outcome.score }
        : outcome.kind === 'error' ? { reason: outcome.reason }
        : {};
      await this.database.db.insert(jobEvents).values({ jobRunId, productId: vizaje.id, eventType, data });
    }

    return outcome;
  }
}

class FakeMakeupSkuDiscoveryService {
  searchCalls = 0;

  constructor(
    private readonly database: DatabaseService,
    // 'throw' simulates an actual search-REQUEST failure (the HTTP call
    // to the parser erroring); a number simulates a successful response
    // with that many results (0 feeds the cooldown-pattern detector,
    // non-zero never does) - see the search-error-wiring tests below.
    private readonly searchResultCounts: () => number | 'throw',
  ) {}

  async searchOne(): Promise<{ query: string; results: unknown[] }> {
    this.searchCalls += 1;
    const next = this.searchResultCounts();
    if (next === 'throw') throw new Error('simulated search-request failure');
    return { query: 'fake', results: Array.from({ length: next }, (_, i) => ({ external_id: `fake-${i}` })) };
  }

  async scoreAndPersist(vizaje: DiscoveryTarget, _competitor: { id: number }, _search: unknown, jobRunId: number | null): Promise<SkuOutcome> {
    // Never actually reached in the cooldown-safety-limit scenario (job9)
    // - cooldown always triggers before scoring would run there. IS
    // reached in the search-error-wiring test below, where searchOne()
    // deliberately returns non-empty results so cooldown detection never
    // fires. Mirrors the REAL MakeupSkuDiscoveryService.scoreAndPersist's
    // job_events emission (see recordTerminalOutcome) so
    // recomputeCounters() sees the same shape a real outcome would
    // produce - WITHOUT writing anything to discovery_attempts
    // (deliberately: keeps the tiny synthetic product pool reusable
        // across many fake calls, same property job9 already relies on).
    if (jobRunId != null) {
      await this.database.db.insert(jobEvents).values({ jobRunId, productId: vizaje.id, eventType: 'product_no_match', data: {} });
    }
    return { kind: 'no_match', parseSuccesses: 0 };
  }
}

async function main() {
  const database = new DatabaseService();
  const persistence = new CompetitorPersistenceService(database);
  const discoveryState = new DiscoveryStateService(database);
  const jobsService = new DiscoveryJobsService(database, persistence);
  // Milestone 3 added two more DiscoveryWorkerService constructor params.
  // None of the Milestone 2 worker-mechanics tests below exercise AI
  // review - ai.enabled stays false in this script's app_settings row
  // (the Milestone 1 seed default), so this stub's getAiEnabled() always
  // resolving false is enough for the worker's 'ambiguous' case to short-
  // circuit before ever touching aiReview - see
  // verify-milestone3-ai-review.ts for the actual AI-path tests.
  const noAiSettings = { getAiEnabled: async () => false } as unknown as AppSettingsService;
  const noAiReview = {} as unknown as DiscoveryAiReviewService;

  const insertedProductIds: number[] = [];
  const insertedJobRunIds: number[] = [];
  const BRAND = `${PREFIX}brand`;

  try {
    await database.db
      .insert(brands)
      .values({ canonicalKey: canonicalBrand(BRAND), displayName: 'Test M2 Brand' })
      .onConflictDoNothing({ target: brands.canonicalKey });

    const productRows = await database.db
      .insert(products)
      .values(
        Array.from({ length: 6 }, (_, i) => ({
          sourceKey: `${PREFIX}p${i}`,
          brand: BRAND,
          name: `Test M2 Product ${i}`,
          url: `https://vizaje-nica.md/${PREFIX}p${i}`,
          imageUrl: `https://vizaje-nica.md/images/${PREFIX}p${i}.jpg`,
        })),
      )
      .returning({ id: products.id });
    for (const row of productRows) insertedProductIds.push(row.id);

    const [makeupCompetitor] = await database.db
      .insert(competitors)
      .values({ name: 'MAKEUP', domain: 'makeup.md' })
      .onConflictDoNothing({ target: competitors.domain })
      .returning({ id: competitors.id });
    const makeupId =
      makeupCompetitor?.id ??
      (await database.db.select({ id: competitors.id }).from(competitors).where(eq(competitors.domain, 'makeup.md')))[0]!.id;

    const [ovicoCompetitor] = await database.db
      .insert(competitors)
      .values({ name: 'OVICO', domain: 'ovico.md' })
      .onConflictDoNothing({ target: competitors.domain })
      .returning({ id: competitors.id });
    const ovicoId =
      ovicoCompetitor?.id ??
      (await database.db.select({ id: competitors.id }).from(competitors).where(eq(competitors.domain, 'ovico.md')))[0]!.id;

    // --- enqueue / validation / duplicate-active-job ------------------------
    console.log('=== enqueue creates a queued job_runs row ===');
    const job1 = await jobsService.enqueue({
      competitor: 'ovico',
      mode: 'limited',
      brand: BRAND,
      onlyUnmatched: true,
      limit: 2,
      productBudgetSeconds: 60,
    });
    insertedJobRunIds.push(job1.id);
    check('status is queued', job1.status === 'queued');
    check('mode persisted', job1.mode === 'limited');
    check('params carries exactly the user-supplied fields', (job1.params as { limit: number }).limit === 2);

    const [queuedEvent] = await database.db
      .select()
      .from(jobEvents)
      .where(and(eq(jobEvents.jobRunId, job1.id), eq(jobEvents.eventType, 'job_queued')));
    check('job_queued event emitted on enqueue', Boolean(queuedEvent));

    console.log('=== duplicate active job for the same competitor is rejected ===');
    let duplicateRejected = false;
    try {
      await jobsService.enqueue({ competitor: 'ovico', mode: 'limited', limit: 1, productBudgetSeconds: 60 });
    } catch (error) {
      duplicateRejected = typeof (error as { getStatus?: () => number }).getStatus === 'function' && (error as { getStatus: () => number }).getStatus() === 409;
    }
    check('second OVICO enqueue while job1 is active is rejected (409)', duplicateRejected);

    console.log('=== MAKEUP and OVICO jobs are isolated by competitor ===');
    const makeupJobWhileOvicoActive = await jobsService.enqueue({
      competitor: 'makeup',
      mode: 'limited',
      limit: 1,
      productBudgetSeconds: 60,
    });
    insertedJobRunIds.push(makeupJobWhileOvicoActive.id);
    check(
      'a MAKEUP job can be enqueued while an OVICO job is active - different competitors never conflict',
      makeupJobWhileOvicoActive.status === 'queued',
    );
    await jobsService.requestStop(makeupJobWhileOvicoActive.id); // tidy up - not needed for this test further

    // --- atomic claim --------------------------------------------------------
    console.log('=== atomic claim: queued -> running, second claim gets nothing ===');
    const fakeOvicoNoMatch = new FakeOvicoSkuDiscoveryService(database, discoveryState, async () => ({
      kind: 'no_match',
      parseSuccesses: 0,
    }));
    const fakeMakeupInert = new FakeMakeupSkuDiscoveryService(database, () => 1);
    const worker = new DiscoveryWorkerService(
      database,
      jobsService,
      fakeMakeupInert as never,
      fakeOvicoNoMatch as never,
      discoveryState,
      noAiSettings,
      noAiReview,
    ) as unknown as {
      claim(id: number): Promise<typeof job1 | null>;
      reconcile(): Promise<void>;
      runJob(job: typeof job1): Promise<void>;
      startHeartbeat(id: number): void;
      stopHeartbeat(id: number): void;
    };

    const claimed = await worker.claim(job1.id);
    check('first claim succeeds and transitions to running', claimed?.status === 'running');
    check('startedAt is set on first claim', Boolean(claimed?.startedAt));

    const secondClaim = await worker.claim(job1.id);
    check('a second claim attempt on the same (now running) row returns null', secondClaim === null);

    // --- heartbeat advances independently of a slow fake SKU operation -----
    console.log('=== heartbeat advances independently of a slow in-flight SKU operation ===');
    const slowFakeOvico = new FakeOvicoSkuDiscoveryService(database, discoveryState, async () => {
      await sleep(500);
      return { kind: 'no_match', parseSuccesses: 0 };
    });
    const slowWorker = new DiscoveryWorkerService(
      database,
      jobsService,
      fakeMakeupInert as never,
      slowFakeOvico as never,
      discoveryState,
      noAiSettings,
      noAiReview,
    ) as unknown as typeof worker;

    const [beforeHeartbeat] = await database.db.select({ heartbeatAt: jobRuns.heartbeatAt }).from(jobRuns).where(eq(jobRuns.id, job1.id));
    slowWorker.startHeartbeat(job1.id);
    const runPromise = slowWorker.runJob({ ...claimed!, params: { ...((claimed!.params as object)), limit: 1 } } as typeof job1);
    await sleep(350); // heartbeat interval is overridden to ~150ms for this script - see header
    const [duringHeartbeat] = await database.db.select({ heartbeatAt: jobRuns.heartbeatAt }).from(jobRuns).where(eq(jobRuns.id, job1.id));
    check(
      'heartbeat advanced WHILE a single slow (500ms) fake SKU call was still in flight',
      Boolean(duringHeartbeat?.heartbeatAt && beforeHeartbeat?.heartbeatAt && duringHeartbeat.heartbeatAt.getTime() > beforeHeartbeat.heartbeatAt.getTime()),
    );
    await runPromise;
    slowWorker.stopHeartbeat(job1.id);
    check('the slow in-flight operation was allowed to finish normally (never force-aborted)', slowFakeOvico.calls.length === 1);

    const [afterLimitedRun] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job1.id));
    check('limited mode (limit=1 for this check) completes with limit_reached', afterLimitedRun?.status === 'completed' && afterLimitedRun?.stopReason === 'limit_reached');

    // --- limit reached / counters -------------------------------------------
    console.log('=== limit reached -> completed, counters match actual outcomes ===');
    const job2 = await jobsService.enqueue({
      competitor: 'ovico',
      mode: 'limited',
      brand: BRAND,
      onlyUnmatched: true,
      limit: 3,
      productBudgetSeconds: 60,
    });
    insertedJobRunIds.push(job2.id);

    let outcomeSeq = 0;
    const mixedOvico = new FakeOvicoSkuDiscoveryService(database, discoveryState, async (callIndex, vizaje) => {
      outcomeSeq = callIndex;
      if (callIndex === 1) return { kind: 'no_match', parseSuccesses: 1 };
      if (callIndex === 2) return { kind: 'error', reason: 'search_error', parseSuccesses: 0 };
      // callIndex 3: synthetic 'auto' - persist a real match directly.
      const [cp] = await database.db
        .insert(competitorProducts)
        .values({ competitorId: ovicoId, externalId: `${PREFIX}auto-${vizaje.id}`, title: 'fake auto match', url: `https://ovico.md/${PREFIX}auto-${vizaje.id}` })
        .returning({ id: competitorProducts.id });
      const [cpv] = await database.db
        .insert(competitorProductVariants)
        .values({ competitorProductId: cp!.id, externalId: `${PREFIX}auto-variant-${vizaje.id}` })
        .returning({ id: competitorProductVariants.id });
      await database.db.insert(matches).values({ productId: vizaje.id, competitorProductVariantId: cpv!.id, source: 'auto', score: 99 });
      await discoveryState.recordMatched(vizaje.id, ovicoId);
      return {
        kind: 'auto',
        score: 99,
        variantId: cpv!.id,
        matchOutcome: 'inserted',
        competitorExternalId: `${PREFIX}auto-${vizaje.id}`,
        competitorTitle: 'fake auto match',
        variantLabel: null,
        variantVolume: null,
        price: null,
        parseSuccesses: 1,
      };
    });

    const claimed2 = await worker.claim(job2.id);
    const worker2 = new DiscoveryWorkerService(database, jobsService, fakeMakeupInert as never, mixedOvico as never, discoveryState, noAiSettings, noAiReview) as unknown as typeof worker;
    await worker2.runJob(claimed2!);

    const [job2Row] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job2.id));
    check('job2 completed with limit_reached', job2Row?.status === 'completed' && job2Row?.stopReason === 'limit_reached');
    check('processedCount === 3', job2Row?.processedCount === 3);
    check('noMatchCount === 1', job2Row?.noMatchCount === 1);
    check('errorCount === 1 and retryCount === 1', job2Row?.errorCount === 1 && job2Row?.retryCount === 1);
    check('autoCount === 1', job2Row?.autoCount === 1);
    check('outcomeSeq reached 3 distinct products', outcomeSeq === 3 && mixedOvico.calls.length === 3);

    const jobEventsForJob2 = await database.db.select().from(jobEvents).where(eq(jobEvents.jobRunId, job2.id));
    const eventTypes = jobEventsForJob2.map(e => e.eventType);
    check('job_started event present', eventTypes.includes('job_started'));
    check('product_started emitted 3 times', eventTypes.filter(t => t === 'product_started').length === 3);
    check('product_auto_matched, product_no_match, product_error all emitted', ['product_auto_matched', 'product_no_match', 'product_error'].every(t => eventTypes.includes(t)));
    check('job_completed event present and comes after the product_* events', eventTypes[eventTypes.length - 1] === 'job_completed');

    // --- pool exhausted -------------------------------------------------------
    console.log('=== eligible pool exhausted -> completed/pool_exhausted ===');
    const job3 = await jobsService.enqueue({
      competitor: 'ovico',
      mode: 'continuous',
      brand: `${PREFIX}no-such-brand-at-all`,
      productBudgetSeconds: 60,
    });
    insertedJobRunIds.push(job3.id);
    const claimed3 = await worker.claim(job3.id);
    const neverCalledOvico = new FakeOvicoSkuDiscoveryService(database, discoveryState, async () => {
      throw new Error('should never be called - brand filter matches zero products');
    });
    const worker3 = new DiscoveryWorkerService(database, jobsService, fakeMakeupInert as never, neverCalledOvico as never, discoveryState, noAiSettings, noAiReview) as unknown as typeof worker;
    await worker3.runJob(claimed3!);
    const [job3Row] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job3.id));
    check('job3 completed with pool_exhausted', job3Row?.status === 'completed' && job3Row?.stopReason === 'pool_exhausted');
    check('the fake sku-discovery service was never called', neverCalledOvico.calls.length === 0);

    // --- cooperative stop on a running job -----------------------------------
    console.log('=== cooperative stop: running -> stopping -> cancelled, never aborts the in-flight op ===');
    const job4 = await jobsService.enqueue({
      competitor: 'ovico',
      mode: 'continuous',
      brand: BRAND,
      onlyUnmatched: true,
      productBudgetSeconds: 60,
    });
    insertedJobRunIds.push(job4.id);
    const claimed4 = await worker.claim(job4.id);

    const stoppingOvico = new FakeOvicoSkuDiscoveryService(database, discoveryState, async callIndex => {
      if (callIndex === 1) {
        // Simulate the user clicking stop WHILE this first SKU's call is
        // conceptually "in flight" - the call is still allowed to finish
        // and return normally; the worker only checks stopRequested
        // BEFORE starting the NEXT SKU, never mid-call.
        await jobsService.requestStop(job4.id);
      }
      return { kind: 'no_match', parseSuccesses: 0 };
    });
    const worker4 = new DiscoveryWorkerService(database, jobsService, fakeMakeupInert as never, stoppingOvico as never, discoveryState, noAiSettings, noAiReview) as unknown as typeof worker;
    await worker4.runJob(claimed4!);

    const [job4Row] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job4.id));
    check('job4 cancelled with user_requested', job4Row?.status === 'cancelled' && job4Row?.stopReason === 'user_requested');
    check('exactly one SKU was processed before stopping (the in-flight one finished, no second one started)', stoppingOvico.calls.length === 1);
    const job4Events = (await database.db.select().from(jobEvents).where(eq(jobEvents.jobRunId, job4.id))).map(e => e.eventType);
    check('job_stopping emitted before job_cancelled', job4Events.indexOf('job_stopping') < job4Events.indexOf('job_cancelled') && job4Events.indexOf('job_stopping') >= 0);

    console.log('=== stop on a still-queued job cancels it immediately, no worker involvement ===');
    const job5 = await jobsService.enqueue({ competitor: 'makeup', mode: 'limited', limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(job5.id);
    const stopped5 = await jobsService.requestStop(job5.id);
    check('queued job is cancelled directly by requestStop, without ever being claimed', stopped5.status === 'cancelled' && stopped5.stopReason === 'user_requested');

    // --- reconciliation -------------------------------------------------------
    console.log('=== reconciliation: stale running + no stop -> requeued (same row) ===');
    const job6 = await jobsService.enqueue({ competitor: 'makeup', mode: 'limited', limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(job6.id);
    await worker.claim(job6.id);
    await database.db
      .update(jobRuns)
      .set({ heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) }) // 10 minutes ago - well past any sane lease
      .where(eq(jobRuns.id, job6.id));
    await worker.reconcile();
    const [job6Row] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job6.id));
    check('stale running job (no stop requested) is requeued, same row id', job6Row?.status === 'queued' && job6Row?.id === job6.id);
    check('workerId/heartbeatAt/currentProductId cleared on requeue', job6Row?.workerId === null && job6Row?.heartbeatAt === null && job6Row?.currentProductId === null);
    const job6RecoveredEvents = (await database.db.select().from(jobEvents).where(eq(jobEvents.jobRunId, job6.id))).filter(e => e.eventType === 'job_recovered');
    check('job_recovered event emitted for the requeue', job6RecoveredEvents.length >= 1);
    await jobsService.requestStop(job6.id); // frees the MAKEUP competitor slot for the tests below

    console.log('=== reconciliation: stale running + stopRequested -> cancelled ===');
    const job7 = await jobsService.enqueue({ competitor: 'ovico', mode: 'limited', limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(job7.id);
    await worker.claim(job7.id);
    await database.db
      .update(jobRuns)
      .set({ heartbeatAt: new Date(Date.now() - 10 * 60 * 1000), stopRequested: true })
      .where(eq(jobRuns.id, job7.id));
    await worker.reconcile();
    const [job7Row] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job7.id));
    check('stale running job WITH stop requested is cancelled, not requeued', job7Row?.status === 'cancelled' && job7Row?.stopReason === 'user_requested');

    console.log('=== reconciliation: stale stopping -> cancelled ===');
    const job8 = await jobsService.enqueue({ competitor: 'makeup', mode: 'limited', limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(job8.id);
    await worker.claim(job8.id);
    await database.db
      .update(jobRuns)
      .set({ heartbeatAt: new Date(Date.now() - 10 * 60 * 1000), status: 'stopping' })
      .where(eq(jobRuns.id, job8.id));
    await worker.reconcile();
    const [job8Row] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job8.id));
    check('stale stopping job is cancelled', job8Row?.status === 'cancelled' && job8Row?.stopReason === 'user_requested');

    // --- 'processing' row from a dead job becomes eligible again ------------
    console.log("=== a 'processing' row owned by a dead job becomes eligible again ===");
    // Neutralize every still-never-checked product first (products[4],[5] -
    // see the earlier job2/heartbeat-test outcomes for why 0/1/2/3 are
    // already non-never-checked) so the deterministic "never-checked first"
    // ordering can't win over the revived 'processing' row below and mask
    // whether Phase 2 (retry-eligible / revived) actually works.
    await discoveryState.recordNoMatch(productRows[4]!.id, ovicoId);
    await discoveryState.recordNoMatch(productRows[5]!.id, ovicoId);

    const [deadJob] = await database.db
      .insert(jobRuns)
      .values({ competitorId: ovicoId, mode: 'limited', status: 'failed', params: { brand: null, inStock: false, onlyUnmatched: true, limit: 1, productBudgetSeconds: 60 }, finishedAt: new Date() })
      .returning();
    insertedJobRunIds.push(deadJob!.id);
    const targetForDeadJob = productRows[0]!;
    await discoveryState.recordProcessing(targetForDeadJob.id, ovicoId, deadJob!.id);

    const selectedAfterDeadJob = await selectNextContinuousTarget(database, 'ovico.md', { brand: BRAND, onlyUnmatched: true });
    check(
      "a 'processing' row owned by a dead (failed) job is selectable again",
      selectedAfterDeadJob?.id === targetForDeadJob.id,
    );

    const [liveJob] = await database.db
      .insert(jobRuns)
      .values({ competitorId: makeupId, mode: 'limited', status: 'running', heartbeatAt: new Date(), params: { brand: null, inStock: false, onlyUnmatched: true, limit: 1, productBudgetSeconds: 60 } })
      .returning();
    insertedJobRunIds.push(liveJob!.id);
    await discoveryState.recordProcessing(targetForDeadJob.id, ovicoId, liveJob!.id);
    const selectedWhileLive = await selectNextContinuousTarget(database, 'ovico.md', { brand: BRAND, onlyUnmatched: true });
    check(
      "the SAME row, now owned by a LIVE (running) job, is NOT selectable",
      selectedWhileLive?.id !== targetForDeadJob.id,
    );
    await discoveryState.recordMatched(targetForDeadJob.id, ovicoId); // cleanup this row's attempt state
    await database.db.update(jobRuns).set({ status: 'completed', finishedAt: new Date() }).where(eq(jobRuns.id, liveJob!.id)); // frees the MAKEUP slot for job9 below

    // --- live policy change affects the next selected SKU, mid-run ----------
    console.log('=== live brand policy change affects the next selectable SKU without restarting anything ===');
    await database.db.update(brands).set({ ovicoDiscoveryEnabled: false }).where(eq(brands.canonicalKey, canonicalBrand(BRAND)));
    const selectedWhileDisabled = await selectNextContinuousTarget(database, 'ovico.md', { brand: BRAND, onlyUnmatched: true });
    check('brand with ovicoDiscoveryEnabled=false yields no selectable target for OVICO', selectedWhileDisabled === null);
    await database.db.update(brands).set({ ovicoDiscoveryEnabled: true }).where(eq(brands.canonicalKey, canonicalBrand(BRAND)));
    const selectedAfterReenable = await selectNextContinuousTarget(database, 'ovico.md', { brand: BRAND, onlyUnmatched: true });
    check('re-enabling the brand makes a target selectable again immediately', selectedAfterReenable !== null);

    // --- MAKEUP safety limit -> failed/operational ---------------------------
    console.log('=== MAKEUP safety limit (cooldown) trips the job to failed/operational ===');
    const job9 = await jobsService.enqueue({
      competitor: 'makeup',
      mode: 'continuous',
      brand: BRAND,
      onlyUnmatched: true,
      productBudgetSeconds: 60,
    });
    insertedJobRunIds.push(job9.id);
    const claimed9 = await worker.claim(job9.id);
    // First call returns a non-empty result (ordinary no_match via
    // scoreAndPersist, not cooldown) so the cooldown window needs the
    // SECOND distinct product's zero-result search to complete the run of
    // MAKEUP_COOLDOWN_THRESHOLD consecutive empties - see header env vars.
    let makeupSearchCall = 0;
    const cooldownMakeup = new FakeMakeupSkuDiscoveryService(database, () => {
      makeupSearchCall += 1;
      return makeupSearchCall === 1 ? 3 : 0;
    });
    const worker9 = new DiscoveryWorkerService(database, jobsService, cooldownMakeup as never, fakeOvicoNoMatch as never, discoveryState, noAiSettings, noAiReview) as unknown as typeof worker;
    await worker9.runJob(claimed9!);
    const [job9Row] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job9.id));
    check(
      'job9 ends failed with failureClass=operational (a safety-triggered abort, never reported as completed)',
      job9Row?.status === 'failed' && job9Row?.failureClass === 'operational',
    );
    check('stopReason is a recognized operational safety reason', ['cooldown_limit', 'deferred_ratio_exceeded', 'search_error_ratio_exceeded'].includes(job9Row?.stopReason ?? ''));

    // --- counter/outcome idempotency across a simulated crash ---------------
    // Exercises the EXACT mechanism the review asked to be proven, not a
    // description of it: the durable outcome write (discovery_attempts)
    // and its job_events row now share one db.transaction(...) (see
    // *SkuDiscoveryService.recordTerminalOutcome), and job_runs' summary
    // counters are recomputed FROM job_events rather than incremented -
    // see DiscoveryWorkerService.recomputeCounters/persistRecomputedCounters.
    console.log('=== counter/outcome idempotency: a crash between the two writes rolls back both, atomically ===');
    const job10 = await jobsService.enqueue({ competitor: 'makeup', mode: 'limited', limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(job10.id);
    const crashProduct = productRows[0]!;

    let sawSimulatedCrash = false;
    try {
      await database.db.transaction(async tx => {
        await discoveryState.recordError(crashProduct.id, makeupId, 'simulated_crash', job10.id, tx);
        await tx.insert(jobEvents).values({ jobRunId: job10.id, productId: crashProduct.id, eventType: 'product_error', data: { reason: 'simulated_crash' } });
        throw new Error('simulated process crash right between the two statements committing');
      });
    } catch {
      sawSimulatedCrash = true;
    }
    check('the simulated crash propagated out of the transaction (not silently swallowed)', sawSimulatedCrash);

    const [attemptAfterCrash] = await database.db
      .select()
      .from(discoveryAttempts)
      .where(and(eq(discoveryAttempts.productId, crashProduct.id), eq(discoveryAttempts.competitorId, makeupId)));
    check(
      'the outcome write rolled back - discovery_attempts was NEVER partially written for the crashed SKU',
      attemptAfterCrash?.lastError !== 'simulated_crash',
    );
    const eventsAfterCrash = await database.db
      .select()
      .from(jobEvents)
      .where(and(eq(jobEvents.jobRunId, job10.id), eq(jobEvents.eventType, 'product_error')));
    check(
      "the paired job_event was ALSO rolled back - it can never exist without its outcome (or vice versa)",
      eventsAfterCrash.length === 0,
    );

    console.log('=== counter/outcome idempotency: once both writes genuinely commit, recompute counts the SKU exactly once - not zero, not twice ===');
    await database.db.transaction(async tx => {
      await discoveryState.recordError(crashProduct.id, makeupId, 'simulated_ok', job10.id, tx);
      await tx.insert(jobEvents).values({ jobRunId: job10.id, productId: crashProduct.id, eventType: 'product_error', data: { reason: 'simulated_ok' } });
    });

    const workerForRecompute = new DiscoveryWorkerService(
      database,
      jobsService,
      fakeMakeupInert as never,
      fakeOvicoNoMatch as never,
      discoveryState,
      noAiSettings,
      noAiReview,
    ) as unknown as {
      recomputeCounters(jobId: number): Promise<{
        processedCount: number;
        autoCount: number;
        aiReviewCount: number;
        noMatchCount: number;
        errorCount: number;
        retryCount: number;
      }>;
      persistRecomputedCounters(jobId: number): Promise<{ processedCount: number; errorCount: number; retryCount: number }>;
    };

    const recomputedOnce = await workerForRecompute.recomputeCounters(job10.id);
    check(
      'recompute immediately after the real (non-crashed) write counts the SKU exactly once',
      recomputedOnce.errorCount === 1 && recomputedOnce.retryCount === 1 && recomputedOnce.processedCount === 1,
    );
    const recomputedTwice = await workerForRecompute.recomputeCounters(job10.id);
    check(
      'recomputing AGAIN (simulating a later crash-recovery/retry pass over the same durable state) still yields exactly one - recompute can never double-count',
      recomputedTwice.errorCount === 1 && recomputedTwice.processedCount === 1,
    );

    // Now simulate the ONE remaining, narrower window the review flagged:
    // the outcome+event transaction committed, but job_runs.errorCount/
    // processedCount were never persisted (as if the process crashed right
    // after that commit but before persistRecomputedCounters() ran on this
    // same SKU). job10's row has never had its counters written in this
    // test, so it is still sitting at its enqueue-time default of 0 -
    // exactly the "permanently under-counted" state the review asked this
    // not to be allowed to stay in forever.
    const [job10RowBefore] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job10.id));
    check('job_runs.errorCount is still 0 before recovery runs (nothing has persisted it yet)', job10RowBefore?.errorCount === 0);

    const persisted = await workerForRecompute.persistRecomputedCounters(job10.id);
    check(
      'persistRecomputedCounters() (called at the top of every runJob execution, and after every SKU, and in finalize()) recovers the correct count from durable job_events',
      persisted.errorCount === 1 && persisted.processedCount === 1,
    );
    const [job10RowAfter] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job10.id));
    check(
      'the job_runs row itself now reflects the recovered count - exactly once, never zero and never doubled',
      job10RowAfter?.errorCount === 1 && job10RowAfter?.processedCount === 1,
    );
    await jobsService.requestStop(job10.id); // still queued (never claimed/run) - frees the MAKEUP slot for the tests below

    // --- AUTO-match idempotency specifically ---------------------------------
    // The `matches` row (not discovery_attempts) is what removes an
    // AUTO-matched SKU from future eligibility - a different, more
    // dangerous failure window than no_match/error/pending_review, where
    // discoveryState.recordX() alone IS the whole durable outcome. Before
    // this round's fix, persistSingleAutoMatch() (which writes `matches`)
    // ran OUTSIDE any transaction, before recordTerminalOutcome's own
    // transaction even opened - so a crash between the matches insert and
    // its product_auto_matched event could leave a correctly-matched SKU
    // with no event ever recorded, which recompute-from-job_events could
    // never recover on its own (the SKU is now matched, so it's never
    // reselected/reprocessed to produce one). Fixed by giving
    // persistSingleAutoMatch() an optional `tx` (matching.service.ts) and
    // having both *SkuDiscoveryService's AUTO branch open ONE transaction
    // spanning persistSingleAutoMatch + recordMatched + the job_events
    // insert - see makeup-sku-discovery.service.ts/ovico-sku-discovery.service.ts.
    console.log('=== AUTO-match idempotency: the matches write and its job_event commit/rollback together, atomically ===');
    const job13 = await jobsService.enqueue({ competitor: 'ovico', mode: 'limited', limit: 1, productBudgetSeconds: 60 });
    insertedJobRunIds.push(job13.id);
    const matching = new MatchingService(database);
    // productRows[5] was only ever touched via discoveryState.recordNoMatch
    // for OVICO (see the 'processing' row test above) - never matched, so
    // persistSingleAutoMatch takes the clean 'inserted' path here instead
    // of colliding with job2's existing (higher-scored) auto match on a
    // different product and being correctly rejected as 'conflict'.
    const autoCrashProduct = productRows[5]!;

    const [crashCp] = await database.db
      .insert(competitorProducts)
      .values({ competitorId: ovicoId, externalId: `${PREFIX}autocrash`, title: 'fake auto-crash variant', url: `https://ovico.md/${PREFIX}autocrash` })
      .returning({ id: competitorProducts.id });
    const [crashCpv] = await database.db
      .insert(competitorProductVariants)
      .values({ competitorProductId: crashCp!.id, externalId: `${PREFIX}autocrash-variant` })
      .returning({ id: competitorProductVariants.id });

    let sawAutoCrash = false;
    try {
      await database.db.transaction(async tx => {
        await matching.persistSingleAutoMatch(autoCrashProduct.id, ovicoId, crashCpv!.id, 97, tx);
        await discoveryState.recordMatched(autoCrashProduct.id, ovicoId, tx);
        await tx.insert(jobEvents).values({ jobRunId: job13.id, productId: autoCrashProduct.id, eventType: 'product_auto_matched', data: { score: 97 } });
        throw new Error('simulated crash right between the matches write committing and its job_event');
      });
    } catch {
      sawAutoCrash = true;
    }
    check('the simulated crash propagated out of the transaction', sawAutoCrash);

    const [matchAfterCrash] = await database.db.select().from(matches).where(eq(matches.competitorProductVariantId, crashCpv!.id));
    check('the matches row was rolled back - NEVER partially written for the crashed SKU', matchAfterCrash === undefined);
    const autoEventsAfterCrash = await database.db
      .select()
      .from(jobEvents)
      .where(and(eq(jobEvents.jobRunId, job13.id), eq(jobEvents.eventType, 'product_auto_matched')));
    check("the paired job_event was ALSO rolled back - a matches row can never exist without it, or vice versa", autoEventsAfterCrash.length === 0);

    await database.db.transaction(async tx => {
      await matching.persistSingleAutoMatch(autoCrashProduct.id, ovicoId, crashCpv!.id, 97, tx);
      await discoveryState.recordMatched(autoCrashProduct.id, ovicoId, tx);
      await tx.insert(jobEvents).values({ jobRunId: job13.id, productId: autoCrashProduct.id, eventType: 'product_auto_matched', data: { score: 97 } });
    });
    const recomputedAuto = await workerForRecompute.recomputeCounters(job13.id);
    check(
      'once the real (non-crashed) write commits, recompute counts the AUTO match exactly once - not zero, not twice',
      recomputedAuto.autoCount === 1 && recomputedAuto.processedCount === 1,
    );
    const [matchAfterCommit] = await database.db.select().from(matches).where(eq(matches.competitorProductVariantId, crashCpv!.id));
    check('the matches row now exists for real, written in the SAME transaction as its job_event', Boolean(matchAfterCommit));

    // --- search-error wiring fix ---------------------------------------------
    // Outcome-mapping level: a real search-REQUEST failure must report
    // wasSearchError=true; a cooldown pattern detected in a SUCCESSFUL
    // (but empty) response must keep reporting wasSearchError=false. Both
    // are exercised by calling the private runMakeupOne() directly, same
    // access pattern already used for claim/reconcile/runJob above.
    console.log('=== search-error wiring: outcome-mapping is correct at the source (runMakeupOne) ===');
    const probeTarget: DiscoveryTarget = { id: productRows[1]!.id, brand: BRAND, name: 'probe target', volume: null, color: null };

    const throwingMakeup = new FakeMakeupSkuDiscoveryService(database, () => 'throw');
    const workerThrow = new DiscoveryWorkerService(database, jobsService, throwingMakeup as never, fakeOvicoNoMatch as never, discoveryState, noAiSettings, noAiReview) as unknown as {
      runMakeupOne(target: DiscoveryTarget, competitor: { id: number }, jobRunId: number, budget: SkuBudget, cooldownTracker: MakeupCooldownTracker): Promise<SkuOutcome>;
    };
    const outcomeFromRequestFailure = await workerThrow.runMakeupOne(probeTarget, { id: makeupId }, job10.id, new SkuBudget(60), new MakeupCooldownTracker());
    check(
      'a real search-request failure maps to kind=deferred, reason=search_error, wasSearchError=TRUE',
      outcomeFromRequestFailure.kind === 'deferred' && outcomeFromRequestFailure.reason === 'search_error' && outcomeFromRequestFailure.wasSearchError === true,
    );

    const cooldownOnlyMakeup = new FakeMakeupSkuDiscoveryService(database, () => 0);
    const workerCooldown = new DiscoveryWorkerService(database, jobsService, cooldownOnlyMakeup as never, fakeOvicoNoMatch as never, discoveryState, noAiSettings, noAiReview) as unknown as typeof workerThrow;
    // Prime the sliding window with two prior empties (threshold is
    // overridden to 2 via MAKEUP_COOLDOWN_THRESHOLD - see header) so the
    // THIRD empty result (the one runMakeupOne itself records) completes
    // the pattern, exactly as a real consecutive-empty run would.
    const primedTracker = new MakeupCooldownTracker();
    primedTracker.recordResultCount(0);
    primedTracker.recordResultCount(0);
    const outcomeFromCooldown = await workerCooldown.runMakeupOne(probeTarget, { id: makeupId }, job10.id, new SkuBudget(60), primedTracker);
    check(
      'a cooldown pattern detected in a successful-but-empty response maps to kind=deferred, reason=cooldown, wasSearchError=FALSE',
      outcomeFromCooldown.kind === 'deferred' && outcomeFromCooldown.reason === 'cooldown' && outcomeFromCooldown.wasSearchError === false,
    );

    // End-to-end: a real job, through the real worker loop, actually
    // trips with stopReason=search_error_ratio_exceeded (not
    // deferred_ratio_exceeded, even though every search-error also counts
    // toward the deferred numerator - see the pure-math proof in
    // discovery-safety-limits.spec.ts for why the two don't collide here).
    console.log('=== search-error wiring: a real job trips search_error_ratio_exceeded via the real worker loop ===');
    const job12 = await jobsService.enqueue({ competitor: 'makeup', mode: 'continuous', brand: BRAND, onlyUnmatched: true, productBudgetSeconds: 60 });
    insertedJobRunIds.push(job12.id);
    const claimed12 = await worker.claim(job12.id);

    // Only a handful of synthetic MAKEUP products remain eligible at this
    // point in the script (every product this job actually selects gets
    // marked 'processing' for the life of this job - see
    // DISCOVERY_SAFETY_MIN_SAMPLE's header note - so this job can select
    // at most ~5 DISTINCT products before pool_exhausted). The cadence
    // below (1 failure every 3rd call) trips search_error_ratio_exceeded
    // at call 4, well inside that budget: attempt 4, denom=4 (minSample=4
    // via env), deferredSoFar=searchErrorsSoFar=1 -> deferredRatio=0.25
    // (not > 0.3, does not trip), searchErrorRatio=0.25 (> 0.1, trips).
    let call12 = 0;
    const mixedFailureMakeup = new FakeMakeupSkuDiscoveryService(database, () => {
      call12 += 1;
      // Every 3rd call is a genuine search-request failure; the rest
      // return 2 (non-empty, non-zero) results so cooldown detection
      // never fires at all in this scenario - the ONLY source of
      // deferred/search-error here is the explicit throw.
      return call12 % 3 === 0 ? 'throw' : 2;
    });
    const worker12 = new DiscoveryWorkerService(database, jobsService, mixedFailureMakeup as never, fakeOvicoNoMatch as never, discoveryState, noAiSettings, noAiReview) as unknown as typeof worker;
    await worker12.runJob(claimed12!);

    const [job12Row] = await database.db.select().from(jobRuns).where(eq(jobRuns.id, job12.id));
    check(
      'job12 ends failed/operational specifically via search_error_ratio_exceeded',
      job12Row?.status === 'failed' && job12Row?.failureClass === 'operational' && job12Row?.stopReason === 'search_error_ratio_exceeded',
    );
    check(
      'deferred_ratio_exceeded did NOT fire first, even though every search-error-deferred SKU also counts toward the deferred numerator',
      job12Row?.stopReason !== 'deferred_ratio_exceeded',
    );
    check('the trip happened exactly at call 4, as computed - never reaching pool_exhausted', mixedFailureMakeup.searchCalls === 4);

    console.log();
    if (failures > 0) {
      console.log(`${failures} assertion(s) FAILED`);
      process.exitCode = 1;
    } else {
      console.log('All assertions PASSED');
    }
  } finally {
    const jobIds = insertedJobRunIds.length > 0 ? insertedJobRunIds : [-1];
    const productIds = insertedProductIds.length > 0 ? insertedProductIds : [-1];

    await database.db.delete(jobEvents).where(inArray(jobEvents.jobRunId, jobIds));
    await database.db.delete(discoveryAttempts).where(inArray(discoveryAttempts.productId, productIds));
    await database.db.delete(matches).where(inArray(matches.productId, productIds));
    await database.db.delete(competitorProductVariants).where(ilike(competitorProductVariants.externalId, `${PREFIX}%`));
    await database.db.delete(competitorProducts).where(ilike(competitorProducts.externalId, `${PREFIX}%`));
    await database.db.delete(jobRuns).where(inArray(jobRuns.id, jobIds));
    await database.db.delete(products).where(ilike(products.sourceKey, `${PREFIX}%`));
    await database.db.delete(brands).where(eq(brands.canonicalKey, canonicalBrand(BRAND)));
  }
}

main()
  .then(() => process.exit(failures > 0 ? 1 : 0))
  .catch(error => {
    console.error('[verify-milestone2-worker] FAILED', error);
    process.exit(1);
  });
