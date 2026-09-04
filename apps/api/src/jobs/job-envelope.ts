import type { Logger } from '@nestjs/common';

import type { JobRunEnvelope, JobRunStatus } from './job-run.types';

export function buildEnvelope<T>(
  logger: Logger,
  job: string,
  startedAt: Date,
  status: JobRunStatus,
  reason: string | undefined,
  detail: T | null,
): JobRunEnvelope<T> {
  const finishedAt = new Date();
  const envelope: JobRunEnvelope<T> = {
    job,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    status,
    detail,
  };
  if (reason) envelope.reason = reason;

  logger.log(JSON.stringify(envelope));
  return envelope;
}
