// Structured, uniform envelope every job returns/logs - console/JSON only
// for this milestone, no dashboard, no persistence beyond process logs.
export type JobRunStatus = 'success' | 'failed' | 'skipped_locked' | 'stopped_early';

export type JobRunEnvelope<TDetail> = {
  job: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: JobRunStatus;
  reason?: string;
  detail: TDetail | null;
};
