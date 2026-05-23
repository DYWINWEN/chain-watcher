import { describe, it, expect } from 'vitest';
import { RootConfigSchema } from '../src/config.js';

function baseValidConfig() {
  return {
    threshold_usdt: 100,
    rules: {
      sender_repeats_to: { enabled: true, window_size: 5 },
      receiver_repeats_from: { enabled: true, window_size: 5 },
    },
    blacklist_cex: true,
    chains: {
      eth: { enabled: true, ws_url: 'wss://x', usdt_contract: '0xx', decimals: 6 },
      bsc: { enabled: true, ws_url: 'wss://x', usdt_contract: '0xx', decimals: 18 },
      btc: { enabled: true, ws_url: 'wss://x', api_base: 'https://x' },
    },
    price_oracle: { ttl_seconds: 60, symbols: {} },
    notifiers: {
      dashboard: { enabled: true, port: 8787 },
      telegram: { enabled: false },
    },
    backfill: { enabled: true, concurrency: 2, history_window: 5 },
    workers: { decoder_concurrency: 2, rule_concurrency: 4 },
  };
}

describe('RootConfigSchema', () => {
  it('accepts a baseline valid config', () => {
    const result = RootConfigSchema.safeParse(baseValidConfig());
    expect(result.success).toBe(true);
  });

  it('rejects window_size = 1 — engine cannot hit with a window of 1', () => {
    const cfg = baseValidConfig();
    cfg.rules.sender_repeats_to.window_size = 1;
    const result = RootConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('accepts window_size = 2 (minimum meaningful)', () => {
    const cfg = baseValidConfig();
    cfg.rules.sender_repeats_to.window_size = 2;
    cfg.rules.receiver_repeats_from.window_size = 2;
    const result = RootConfigSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it('accepts window_size = 20 (maximum boundary)', () => {
    const cfg = baseValidConfig();
    cfg.rules.sender_repeats_to.window_size = 20;
    cfg.rules.receiver_repeats_from.window_size = 20;
    const result = RootConfigSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it('rejects window_size = 21 (above max)', () => {
    const cfg = baseValidConfig();
    cfg.rules.sender_repeats_to.window_size = 21;
    const result = RootConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });
});
