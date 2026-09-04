import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Deterministic rotation cursor for discovery target selection - so a
// weekly discovery run does NOT pick the same first N unmatched products
// every time forever. Deliberately NOT a database column (no schema change
// this milestone, per project notes) - just a small local state file, one
// integer per discovery queue (keyed by competitor). "data/vizaje/" already
// holds other operational JSON output and is gitignored for *.json.
//
// Strategy: products.id ascending, wrapping around. Each run consumes the
// next `limit` eligible products after the last id it reached; when fewer
// than `limit` remain above the cursor, it wraps and tops up from the
// beginning. This is "oldest cursor position first" rotation - simple,
// stable, no queue infrastructure.
const STATE_PATH = `${__dirname}/../../../../data/vizaje/discovery-rotation-state.json`;

type RotationState = Record<string, number>;

function readState(): RotationState {
  if (!existsSync(STATE_PATH)) return {};

  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as RotationState;
  } catch {
    return {};
  }
}

export function getRotationCursor(queueKey: string): number {
  return readState()[queueKey] ?? 0;
}

export function setRotationCursor(queueKey: string, lastId: number): void {
  const state = readState();
  state[queueKey] = lastId;
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}
