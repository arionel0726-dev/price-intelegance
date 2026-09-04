import { Injectable, Logger } from '@nestjs/common';

// Simple in-process lock for the first single-instance deployment - no
// distributed locking, no Redis. Lock KEYS are shared by competitor, not by
// individual job name, on purpose: 'makeup' is held by BOTH MAKEUP discovery
// and MAKEUP refresh, so the two can never run concurrently against the
// same site/parser resources (same for 'ovico'). 'vizaje' is its own lock.
// This one mechanism satisfies both "don't run the same job twice" and
// "don't let discovery and refresh for the same competitor overlap".
export type LockKey = 'vizaje' | 'makeup' | 'ovico';

@Injectable()
export class JobLockService {
  private readonly logger = new Logger(JobLockService.name);
  private readonly held = new Map<LockKey, string>();

  tryAcquire(key: LockKey, jobName: string): boolean {
    const current = this.held.get(key);

    if (current) {
      this.logger.warn(`lock "${key}" already held by "${current}" - "${jobName}" skipped`);
      return false;
    }

    this.held.set(key, jobName);
    return true;
  }

  release(key: LockKey): void {
    this.held.delete(key);
  }

  isHeld(key: LockKey): boolean {
    return this.held.has(key);
  }
}
