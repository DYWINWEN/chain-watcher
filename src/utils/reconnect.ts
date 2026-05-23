export type BackoffOpts = {
  initialMs?: number;
  maxMs?: number;
  factor?: number;
  jitter?: number; // 0..1, fraction of delay randomized
};

/** Returns a function that yields the next delay each call, capped at maxMs. */
export function exponentialBackoff(opts: BackoffOpts = {}): () => number {
  const initial = opts.initialMs ?? 1000;
  const max = opts.maxMs ?? 30_000;
  const factor = opts.factor ?? 2;
  const jitter = opts.jitter ?? 0.2;
  let current = initial;
  return () => {
    const base = current;
    current = Math.min(current * factor, max);
    const jitterDelta = base * jitter * (Math.random() * 2 - 1);
    return Math.max(0, Math.floor(base + jitterDelta));
  };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
