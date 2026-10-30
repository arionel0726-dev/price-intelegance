import { hostname } from 'node:os';

import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { and, asc, competitors, count, eq, inArray, isNull, jobEvents, type JobRun, jobRuns, lt, or } from '@price/db';

import { DiscoveryAiReviewService } from '../ai/discovery-ai-review.service';
import { DiscoveryStateService } from '../competitors/discovery-state.service';
import { MakeupBatchPacer } from '../competitors/makeup-batch-pacer';
import { MakeupCooldownTracker } from '../competitors/makeup-cooldown-tracker';
import {
  MAKEUP_COOLDOWN_WAIT_MS,
  MAKEUP_DISCOVERY_BATCH_PAUSE_MS,
  MAKEUP_DISCOVERY_BATCH_SIZE,
  MAKEUP_MAX_COOLDOWN_EVENTS_PER_RUN,
  MAKEUP_MAX_DEFERRED_RATIO,
  MAKEUP_MAX_SEARCH_ERROR_RATIO,
  sleep,
} from '../competitors/makeup-discovery-pacing';
import { MakeupSkuDiscoveryService } from '../competitors/makeup-sku-discovery.service';
import { OvicoSkuDiscoveryService } from '../competitors/ovico-sku-discovery.service';
import { selectNextContinuousTarget, type DiscoveryTarget } from '../competitors/discovery-targets';
import { SkuBudget, type SkuOutcome } from '../competitors/sku-discovery.types';
import { DatabaseService } from '../database/database.service';
import { AppSettingsService } from '../policy/app-settings.service';
import type { CompetitorDomain } from '../policy/policy-precedence';
import { DiscoveryJobsService } from './discovery-jobs.service';
import type { DiscoveryJobParams } from './discovery-jobs.types';
import { evaluateSafetyLimits } from './discovery-safety-limits';
import {
  DISCOVERY_HEARTBEAT_INTERVAL_MS,
  DISCOVERY_LEASE_STALE_MS,
  DISCOVERY_POLL_INTERVAL_MS,
  DISCOVERY_RECONCILE_CRON,
  DISCOVERY_SAFETY_MIN_SAMPLE,
} from './discovery-worker.config';

type TerminalStatus = 'completed' | 'failed' | 'cancelled';
type FailureClass = 'operational' | 'application';

// Milestone 2: the DB-backed discovery job worker. Lives inside the
// existing Nest `api` process - no Redis, no separate container. The
// Postgres `job_runs` table IS the queue: this service polls it, claims
// one row at a time per competitor (the Milestone 1 partial unique index
// `job_runs_active_per_competitor` already guarantees at most one
// active - queued/running/stopping - job per competitor exists to claim),
// and executes it to a terminal state one Vizaje SKU at a time.
//
// MAKEUP and OVICO jobs run concurrently within this one process as
// independent in-flight promises (both are I/O-bound await chains, so
// ordinary Node concurrency is enough - no actual parallelism needed).
@Injectable()
export class DiscoveryWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DiscoveryWorkerService.name);
  private readonly workerId = `${hostname()}:${process.pid}`;
  private readonly heartbeatTimers = new Map<number, ReturnType<typeof setInterval>>();
  private pollInFlight = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: DiscoveryJobsService,
    private readonly makeupSku: MakeupSkuDiscoveryService,
    private readonly ovicoSku: OvicoSkuDiscoveryService,
    private readonly discoveryState: DiscoveryStateService,
    private readonly appSettings: AppSettingsService,
    private readonly aiReview: DiscoveryAiReviewService,
  ) {}

  // Recovery runs once at process start, before the first poll tick could
  // possibly claim anything - a job left 'running'/'stopping' from before
  // this process existed (previous container, previous deploy) is
  // reconciled here, never silently left stuck. Never creates a new
  // job_runs row - only transitions existing ones.
  async onApplicationBootstrap(): Promise<void> {
    await this.reconcile();
  }

  @Interval(DISCOVERY_POLL_INTERVAL_MS)
  async poll(): Promise<void> {
    if (this.pollInFlight) return;
    this.pollInFlight = true;

    try {
      const queued = await this.database.db
        .select()
        .from(jobRuns)
        .where(eq(jobRuns.status, 'queued'))
        .orderBy(asc(jobRuns.id));

      for (const job of queued) {
        const claimed = await this.claim(job.id);
        if (!claimed) continue; // another poll tick/process already claimed it

        this.startHeartbeat(claimed.id);
        this.runJob(claimed)
          .catch(error => this.logger.error(`job ${claimed.id} crashed outside its own guard: ${String(error)}`))
          .finally(() => this.stopHeartbeat(claimed.id));
      }
    } finally {
      this.pollInFlight = false;
    }
  }

  @Cron(DISCOVERY_RECONCILE_CRON)
  async reconcileCron(): Promise<void> {
    await this.reconcile();
  }

  // Atomic claim: queued -> running, in one UPDATE guarded by
  // WHERE status='queued'. Zero rows back means someone else (another
  // poll tick, or - if this ever runs as more than one process - another
  // worker) claimed it first; this process just moves on.
  private async claim(jobId: number): Promise<JobRun | null> {
    const now = new Date();

    const [row] = await this.database.db
      .update(jobRuns)
      .set({ status: 'running', workerId: this.workerId, heartbeatAt: now })
      .where(and(eq(jobRuns.id, jobId), eq(jobRuns.status, 'queued')))
      .returning();

    if (!row) return null;

    // startedAt is set only the FIRST time a job is claimed - a requeued-
    // and-reclaimed job (see reconcile()) keeps its original startedAt, so
    // job duration reporting reflects the whole lifecycle, not just the
    // latest claim.
    if (!row.startedAt) {
      const [withStartedAt] = await this.database.db
        .update(jobRuns)
        .set({ startedAt: now })
        .where(eq(jobRuns.id, jobId))
        .returning();
      if (withStartedAt) Object.assign(row, withStartedAt);
    }

    await this.jobs.emitEvent(row.id, 'job_started', null, { workerId: this.workerId });
    return row;
  }

  private startHeartbeat(jobId: number): void {
    const timer = setInterval(() => {
      this.database.db
        .update(jobRuns)
        .set({ heartbeatAt: new Date() })
        .where(and(eq(jobRuns.id, jobId), inArray(jobRuns.status, ['running', 'stopping'])))
        .catch(error => this.logger.warn(`heartbeat update failed for job ${jobId}: ${String(error)}`));
    }, DISCOVERY_HEARTBEAT_INTERVAL_MS);

    this.heartbeatTimers.set(jobId, timer);
  }

  private stopHeartbeat(jobId: number): void {
    const timer = this.heartbeatTimers.get(jobId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(jobId);
    }
  }

  // Reconciliation - see project notes for the three transitions. Only
  // ever UPDATEs existing job_runs rows; never inserts.
  private async reconcile(): Promise<void> {
    const staleBefore = new Date(Date.now() - DISCOVERY_LEASE_STALE_MS);
    const isStale = or(isNull(jobRuns.heartbeatAt), lt(jobRuns.heartbeatAt, staleBefore));

    const requeued = await this.database.db
      .update(jobRuns)
      .set({
        status: 'queued',
        workerId: null,
        heartbeatAt: null,
        currentProductId: null,
        currentProductStartedAt: null,
      })
      .where(and(eq(jobRuns.status, 'running'), eq(jobRuns.stopRequested, false), isStale))
      .returning();

    for (const job of requeued) {
      this.logger.warn(`job ${job.id} recovered: stale heartbeat with no stop requested - requeued`);
      await this.jobs.emitEvent(job.id, 'job_recovered', null, { reason: 'heartbeat_lost_requeued' });
    }

    const cancelled = await this.database.db
      .update(jobRuns)
      .set({ status: 'cancelled', stopReason: 'user_requested', finishedAt: new Date() })
      .where(
        and(
          or(and(eq(jobRuns.status, 'running'), eq(jobRuns.stopRequested, true)), eq(jobRuns.status, 'stopping')),
          isStale,
        ),
      )
      .returning();

    for (const job of cancelled) {
      this.logger.warn(`job ${job.id} recovered: stale while stopping/stop-requested - cancelled`);
      await this.jobs.emitEvent(job.id, 'job_cancelled', null, { reason: 'stale_stop_recovered' });
    }
  }

  // Idempotency fix (counter/outcome review): job_runs' summary counters
  // are no longer an in-memory running total persisted by a separate
  // UPDATE after the fact - they are recomputed from job_events every
  // time they're written. job_events for a terminal per-SKU outcome is
  // now written in the SAME transaction as the durable
  // discovery_attempts/matches write for that outcome (see
  // MakeupSkuDiscoveryService.recordTerminalOutcome /
  // OvicoSkuDiscoveryService.recordTerminalOutcome), so job_events can
  // never exist without its outcome already being durable, and vice
  // versa. Recomputing from it is therefore always safe to call any
  // number of times, at any point: it can never double-count (it derives
  // from a set of rows that itself cannot contain a duplicate - each SKU
  // selection only reaches one terminal outcome, and selectNextContinuousTarget
  // never reselects an already-terminal SKU within the same retry
  // window), and it can never leave a PERMANENT undercount, because the
  // very next recompute - the next loop iteration, finalize(), or (after
  // a hard crash) the start of the next claimed execution of this same
  // job - picks up any row that was written since the last recompute.
  // 'product_deferred' is deliberately excluded: a deferred SKU persists
  // nothing to discovery_attempts (see SkuOutcome's doc comment), so it
  // must not count toward processedCount either.
  private async recomputeCounters(jobId: number): Promise<{
    processedCount: number;
    autoCount: number;
    aiAutoCount: number;
    aiReviewCount: number;
    noMatchCount: number;
    errorCount: number;
    retryCount: number;
  }> {
    const rows = await this.database.db
      .select({ eventType: jobEvents.eventType, total: count() })
      .from(jobEvents)
      .where(
        and(
          eq(jobEvents.jobRunId, jobId),
          inArray(jobEvents.eventType, [
            'product_auto_matched',
            'product_pending_review',
            'product_ai_auto_matched',
            'product_ai_rejected',
            'product_no_match',
            'product_error',
          ]),
        ),
      )
      .groupBy(jobEvents.eventType);

    const totals = new Map(rows.map(row => [row.eventType, Number(row.total)]));
    const autoCount = totals.get('product_auto_matched') ?? 0;
    const aiAutoCount = totals.get('product_ai_auto_matched') ?? 0;
    const aiRejectedCount = totals.get('product_ai_rejected') ?? 0;
    const pendingReviewRaised = totals.get('product_pending_review') ?? 0;
    // Milestone 3 counter/outcome double-count fix (see project notes -
    // this is exactly the trap flagged in the M2 review): the
    // deterministic-ambiguous moment ALWAYS emits product_pending_review,
    // unconditionally, BEFORE AI (if enabled) runs. If AI then resolves
    // that SAME candidate synchronously in this same job pass - either
    // auto-matching it (product_ai_auto_matched) or rejecting it
    // (product_ai_rejected) - counting product_pending_review on its own
    // would double-count that one candidate: once as "pending review",
    // and again as "ai auto matched"/"no match" via its own event type.
    // Subtracting the two AI-resolution event counts here nets out to
    // exactly the candidates STILL actually awaiting human review after
    // this job's own AI pass - never negative, since product_ai_auto_matched/
    // product_ai_rejected can only ever follow a product_pending_review
    // for the SAME candidate (DiscoveryWorkerService only ever calls AI
    // review right after emitting it, never independently). If AI is
    // disabled (or never runs for this job), both subtracted counts are
    // 0 and aiReviewCount is exactly the raw product_pending_review
    // count, unchanged from pre-Milestone-3 behavior.
    const aiReviewCount = pendingReviewRaised - aiAutoCount - aiRejectedCount;
    // An AI reject IS a no_match resolution in durable-state terms (see
    // DiscoveryAiReviewService.applyVerdict, which calls
    // recordNoMatch for exactly this reason) - counted here so
    // processedCount's sum below stays exactly 1 per candidate
    // regardless of which path resolved it.
    const noMatchCount = (totals.get('product_no_match') ?? 0) + aiRejectedCount;
    const errorCount = totals.get('product_error') ?? 0;
    // recordError() (called from inside the sku-discovery services)
    // always schedules a retryEligibleAt window - that IS the retry being
    // counted, so retryCount tracks errorCount exactly, same as before
    // this fix.
    const retryCount = errorCount;
    const processedCount = autoCount + aiAutoCount + aiReviewCount + noMatchCount + errorCount;

    return { processedCount, autoCount, aiAutoCount, aiReviewCount, noMatchCount, errorCount, retryCount };
  }

  private async persistRecomputedCounters(jobId: number) {
    const counters = await this.recomputeCounters(jobId);
    await this.database.db.update(jobRuns).set(counters).where(eq(jobRuns.id, jobId));
    return counters;
  }

  // The main per-job execution loop - one Vizaje SKU at a time, policy and
  // eligibility evaluated fresh on every iteration (selectNextContinuousTarget
  // never consults job_runs.params for anything beyond the user's own
  // brand/inStock/onlyUnmatched/limit request).
  private async runJob(job: JobRun): Promise<void> {
    const [competitorRow] = await this.database.db.select().from(competitors).where(eq(competitors.id, job.competitorId));

    if (!competitorRow) {
      await this.finalize(job.id, 'failed', 'unexpected_missing_competitor', 'application', 'competitor row not found');
      return;
    }

    const domain = competitorRow.domain as CompetitorDomain;
    const params = job.params as DiscoveryJobParams;

    // Recomputed fresh from job_events rather than trusted from
    // job.processedCount etc - see recomputeCounters() above. This is
    // what actually closes the crash-recovery gap: if the previous
    // execution attempt crashed after a SKU's outcome+event were already
    // committed but before the job_runs row was updated, job.processedCount
    // would under-report that SKU forever; recomputing here picks it up
    // the moment this job is reclaimed.
    let { processedCount, autoCount, aiAutoCount, aiReviewCount, noMatchCount, errorCount, retryCount } =
      await this.recomputeCounters(job.id);

    // In-memory only, scoped to THIS execution attempt - deliberately not
    // persisted. If the job is recovered/requeued and reclaimed, this
    // execution's safety-limit sample restarts; the durable job_runs
    // counters above (which DO carry over) are unaffected. See project
    // notes for why this is an acceptable tradeoff.
    let deferredSoFar = 0;
    let searchErrorsSoFar = 0;
    const cooldownTracker = domain === 'makeup.md' ? new MakeupCooldownTracker() : null;
    // MAKEUP-only, same as cooldownTracker - OVICO never had batching and
    // this stays entirely unconstructed/unused on that path.
    const batchPacer =
      domain === 'makeup.md' ? new MakeupBatchPacer(MAKEUP_DISCOVERY_BATCH_SIZE, MAKEUP_DISCOVERY_BATCH_PAUSE_MS, sleep) : null;

    try {
      while (true) {
        const [fresh] = await this.database.db
          .select({ status: jobRuns.status, stopRequested: jobRuns.stopRequested })
          .from(jobRuns)
          .where(eq(jobRuns.id, job.id));

        // Reconciliation (or a concurrent stop that raced past our own
        // check) already moved this job out of 'running' - nothing left
        // for this execution to do.
        if (!fresh || fresh.status !== 'running') return;

        if (fresh.stopRequested) {
          await this.database.db
            .update(jobRuns)
            .set({ status: 'stopping' })
            .where(and(eq(jobRuns.id, job.id), eq(jobRuns.status, 'running')));
          await this.jobs.emitEvent(job.id, 'job_stopping', null, {});
          // Cooperative stop checkpoint is BEFORE starting a new SKU - no
          // search/retry/candidate-parse for a new product ever starts
          // once stopRequested is observed; nothing in flight to finish.
          await this.finalize(job.id, 'cancelled', 'user_requested', null);
          return;
        }

        if (params.limit != null && processedCount >= params.limit) {
          await this.finalize(job.id, 'completed', 'limit_reached', null);
          return;
        }

        const target = await selectNextContinuousTarget(this.database, domain, {
          brand: params.brand ?? undefined,
          inStock: params.inStock,
          onlyUnmatched: params.onlyUnmatched,
        });

        if (!target) {
          await this.finalize(job.id, 'completed', 'pool_exhausted', null);
          return;
        }

        await this.discoveryState.recordProcessing(target.id, competitorRow.id, job.id);
        await this.database.db
          .update(jobRuns)
          .set({ currentProductId: target.id, currentProductStartedAt: new Date() })
          .where(eq(jobRuns.id, job.id));
        await this.jobs.emitEvent(job.id, 'product_started', target.id, {});

        const budget = new SkuBudget(params.productBudgetSeconds);
        let outcome: SkuOutcome;

        try {
          outcome =
            domain === 'makeup.md'
              ? await this.runMakeupOne(target, competitorRow, job.id, budget, cooldownTracker!)
              : await this.ovicoSku.processOne(target, competitorRow, job.id, budget);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`unexpected error processing product ${target.id} (job ${job.id}): ${message}`);
          // Same atomicity as every other terminal write (see
          // *SkuDiscoveryService.recordTerminalOutcome) - the
          // discovery_attempts write and its job_events row commit
          // together, so recomputeCounters() below can never see one
          // without the other for this SKU.
          await this.database.db.transaction(async tx => {
            await this.discoveryState.recordError(target.id, competitorRow.id, 'unexpected_error', job.id, tx);
            await tx
              .insert(jobEvents)
              .values({ jobRunId: job.id, productId: target.id, eventType: 'product_error', data: { reason: 'unexpected_error' } });
          });
          outcome = { kind: 'error', reason: 'unexpected_error', parseSuccesses: 0 };
        }

        // The terminal per-SKU events (product_auto_matched/
        // product_pending_review/product_no_match/product_error) are
        // already emitted above, atomically with their durable outcome
        // write, inside runMakeupOne/scoreAndPersist/processOne (or the
        // catch block just above) - emitting them again here would
        // double them up in job_events and so double-count them when
        // recomputeCounters() runs. 'deferred' is the one exception: it
        // persists nothing durable (see SkuOutcome's doc comment), so its
        // event is only ever emitted here.
        switch (outcome.kind) {
          case 'deferred':
            deferredSoFar += 1;
            if (outcome.wasSearchError) searchErrorsSoFar += 1;
            await this.jobs.emitEvent(job.id, 'product_deferred', target.id, { reason: outcome.reason });
            break;
          case 'ambiguous':
            // Milestone 3: evaluate the fresh ambiguous candidate against
            // DeepSeek right here, synchronously, in the SAME job pass -
            // covers newly produced candidates with no new
            // infrastructure (see DiscoveryAiReviewService's doc comment
            // for the out-of-band batch path that covers pre-existing
            // candidates instead). product_pending_review was ALREADY
            // emitted, unconditionally, inside scoreAndPersist/
            // processOne above. DiscoveryAiReviewService.applyVerdict()
            // itself now emits the SECOND event (product_ai_auto_matched/
            // product_ai_rejected) when it resolves a candidate - inside
            // the SAME transaction as the match/candidate/attempts
            // writes, and keyed to candidate.jobRunId rather than this
            // job's own id, so an out-of-band processPendingBatch() call
            // resolving this exact candidate LATER (after this job has
            // long finished) still lands the event against the job it
            // actually belongs to. Nothing to emit here anymore -
            // recomputeCounters() subtracts that event back out of
            // aiReviewCount so the candidate is counted exactly once
            // either way (disabled, still-pending-after-AI, or
            // resolved-by-AI, synchronously or later) - see that
            // function's doc comment for the exact arithmetic.
            try {
              await this.aiReview.evaluateCandidate(outcome.candidateId);
              // 'ai_auto_matched'/'rejected' already wrote their own event
              // above; 'pending_review' (approve below threshold),
              // 'unavailable' (disabled/no key), and 'error_stayed_pending'
              // all leave the candidate exactly as product_pending_review
              // already left it - nothing further to do either way.
            } catch (error) {
              // AI review must never fail discovery itself - log and
              // leave the candidate pending (DiscoveryAiReviewService's
              // own internal failure modes already return structured
              // results rather than throwing; this only guards against a
              // genuinely unexpected error, e.g. the hard-conflict
              // invariant assertion).
              this.logger.error(
                `AI review failed for discovery_candidates ${outcome.candidateId} (job ${job.id}): ${String(error)}`,
              );
            }
            break;
          default:
            break;
        }

        // Recomputed (not incremented) from job_events - see
        // recomputeCounters() for why this is what makes the write
        // idempotent regardless of when/whether a crash happens around
        // it. 'deferred' never reaches here with anything to recompute
        // (no job_events row of its own feeds the counters), so this is
        // a no-op write for that branch - still safe and cheap to run
        // every iteration.
        ({ processedCount, autoCount, aiAutoCount, aiReviewCount, noMatchCount, errorCount, retryCount } =
          await this.persistRecomputedCounters(job.id));

        const safetyBreach = evaluateSafetyLimits({
          processedCount,
          deferredSoFar,
          searchErrorsSoFar,
          limit: params.limit,
          minSample: DISCOVERY_SAFETY_MIN_SAMPLE,
          maxDeferredRatio: MAKEUP_MAX_DEFERRED_RATIO,
          maxSearchErrorRatio: MAKEUP_MAX_SEARCH_ERROR_RATIO,
        });
        if (safetyBreach) {
          await this.finalize(job.id, 'failed', safetyBreach, 'operational', `${safetyBreach} - safety limit exceeded for this run`);
          return;
        }

        if (cooldownTracker && cooldownTracker.cooldownEventsInRun > MAKEUP_MAX_COOLDOWN_EVENTS_PER_RUN) {
          await this.finalize(job.id, 'failed', 'cooldown_limit', 'operational', 'cooldown limit exceeded for this run');
          return;
        }

        // Pacing between SKUs - MAKEUP only, exact legacy batch shape (see
        // MakeupBatchPacer): a burst of MAKEUP_DISCOVERY_BATCH_SIZE SKUs,
        // then one full MAKEUP_DISCOVERY_BATCH_PAUSE_MS pause, repeating.
        // A 'deferred' (cooldown) outcome does not tick this - see
        // MakeupBatchPacer's doc comment for why.
        if (batchPacer && outcome.kind !== 'deferred') {
          await batchPacer.afterProduct();
        }
      }
    } catch (fatal) {
      const message = fatal instanceof Error ? fatal.message : String(fatal);
      await this.finalize(job.id, 'failed', 'unhandled_exception', 'application', message);
    }
  }

  // MAKEUP-only: one single-item search, fed into the sliding-window
  // cooldown adaptation (see MakeupCooldownTracker), then delegated to the
  // shared scoring/persistence logic. OVICO has no equivalent - it calls
  // OvicoSkuDiscoveryService.processOne() directly from runJob() above.
  private async runMakeupOne(
    target: DiscoveryTarget,
    competitor: { id: number },
    jobRunId: number,
    budget: SkuBudget,
    cooldownTracker: MakeupCooldownTracker,
  ): Promise<SkuOutcome> {
    let search;
    try {
      search = await this.makeupSku.searchOne(target);
    } catch (error) {
      this.logger.warn(`search request failed for vizaje id=${target.id} (job ${jobRunId}): ${String(error)}`);
      // An actual search-REQUEST failure (the HTTP call to the parser
      // throwing/erroring), as distinct from a cooldown pattern detected
      // in a successful-but-empty response below. Both are 'deferred'
      // (never searched to a conclusion - nothing persisted, this SKU
      // stays exactly as eligible as before), but ONLY this one also
      // counts toward the search-error ratio via wasSearchError - see
      // evaluateSafetyLimits's searchErrorsSoFar. Matches the legacy
      // MakeupTargetedSyncService.sync() batch-level behavior exactly: a
      // search batch request that throws counts toward BOTH
      // deferredProductIds and searchErrors. This call never reaches
      // cooldownTracker.recordResultCount() - a request failure carries
      // no result count to feed the cooldown-pattern detector, and must
      // not be confused with a legitimate empty-but-successful response.
      return { kind: 'deferred', reason: 'search_error', wasSearchError: true };
    }

    cooldownTracker.recordResultCount(search.results.length);

    if (cooldownTracker.isCooldownDetected()) {
      await this.jobs.emitEvent(jobRunId, 'cooldown_started', target.id, {});
      await sleep(MAKEUP_COOLDOWN_WAIT_MS);

      const probe = await this.makeupSku.searchOne(target).catch(() => null);

      if (probe && probe.results.length > 0) {
        cooldownTracker.reset();
        await this.jobs.emitEvent(jobRunId, 'cooldown_finished', target.id, { recovered: true });
        search = probe;
      } else {
        cooldownTracker.cooldownEventsInRun += 1;
        await this.jobs.emitEvent(jobRunId, 'cooldown_finished', target.id, { recovered: false });
        // Deferred - never searched to a conclusion, so nothing is
        // persisted to discovery_attempts; this SKU stays exactly as
        // eligible as it was before this attempt.
        return { kind: 'deferred', reason: 'cooldown', wasSearchError: false };
      }
    }

    return this.makeupSku.scoreAndPersist(target, competitor, search, jobRunId, budget);
  }

  private async finalize(
    jobId: number,
    status: TerminalStatus,
    stopReason: string,
    failureClass: FailureClass | null,
    errorMessage?: string,
  ): Promise<void> {
    // One last defensive recompute before the job goes terminal - cheap
    // and idempotent (see recomputeCounters()), and closes the gap for
    // the unhandled-exception path (the outer catch below), which can
    // reach finalize() without the loop's own per-iteration recompute
    // having run for whichever SKU was in flight when it threw.
    const counters = await this.recomputeCounters(jobId);

    await this.database.db
      .update(jobRuns)
      .set({
        ...counters,
        status,
        stopReason,
        failureClass,
        error: errorMessage ?? null,
        finishedAt: new Date(),
        currentProductId: null,
        currentProductStartedAt: null,
      })
      .where(eq(jobRuns.id, jobId));

    const eventType = status === 'completed' ? 'job_completed' : status === 'failed' ? 'job_failed' : 'job_cancelled';
    await this.jobs.emitEvent(jobId, eventType, null, { stopReason, failureClass });
  }
}
