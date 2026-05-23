import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import 'dotenv/config';
import { getDb } from './storage/db.js';
import { logger } from './utils/logger.js';
import { bus, EVENTS } from './utils/event-bus.js';

const ChainCfgEvm = z.object({
  enabled: z.boolean(),
  ws_url: z.string().min(1),
  usdt_contract: z.string().min(1),
  decimals: z.number().int().positive(),
});
const ChainCfgBtc = z.object({
  enabled: z.boolean(),
  ws_url: z.string().min(1),
  api_base: z.string().min(1),
});

export const RootConfigSchema = z.object({
  threshold_usdt: z.number().nonnegative(),
  rules: z.object({
    sender_repeats_to: z.object({ enabled: z.boolean(), window_size: z.number().int().min(1).max(20) }),
    receiver_repeats_from: z.object({ enabled: z.boolean(), window_size: z.number().int().min(1).max(20) }),
  }),
  blacklist_cex: z.boolean(),
  chains: z.object({
    eth: ChainCfgEvm,
    bsc: ChainCfgEvm,
    btc: ChainCfgBtc,
  }),
  price_oracle: z.object({
    ttl_seconds: z.number().int().positive(),
    symbols: z.record(z.string(), z.string()),
  }),
  notifiers: z.object({
    dashboard: z.object({ enabled: z.boolean(), port: z.number().int().positive() }),
    telegram: z.object({
      enabled: z.boolean(),
      bot_token: z.string().optional().default(''),
      chat_id: z.string().optional().default(''),
      min_level: z.string().optional().default('info'),
    }),
  }),
  backfill: z.object({
    enabled: z.boolean(),
    concurrency: z.number().int().positive(),
    history_window: z.number().int().positive(),
  }),
  workers: z.object({
    decoder_concurrency: z.number().int().positive(),
    rule_concurrency: z.number().int().positive(),
  }),
});

export type RootConfig = z.infer<typeof RootConfigSchema>;

const ENV_VAR_RE = /\$\{([A-Z0-9_]+)\}/g;

function expandEnv(input: unknown): unknown {
  if (typeof input === 'string') {
    return input.replace(ENV_VAR_RE, (_, name) => process.env[name] ?? '');
  }
  if (Array.isArray(input)) return input.map(expandEnv);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = expandEnv(v);
    return out;
  }
  return input;
}

export function loadSeedConfig(seedPath = './config/rules.yaml'): RootConfig {
  const text = readFileSync(resolve(seedPath), 'utf8');
  const raw = yaml.load(text);
  const expanded = expandEnv(raw);
  return RootConfigSchema.parse(expanded);
}

// ---- settings table flat key/value ----

const SETTINGS_KEYS = {
  threshold_usdt: 'threshold_usdt',
  blacklist_cex: 'blacklist_cex',
  rule_sender_enabled: 'rule.sender_repeats_to.enabled',
  rule_sender_window: 'rule.sender_repeats_to.window_size',
  rule_receiver_enabled: 'rule.receiver_repeats_from.enabled',
  rule_receiver_window: 'rule.receiver_repeats_from.window_size',
  chain_eth_enabled: 'chain.eth.enabled',
  chain_eth_ws_url: 'chain.eth.ws_url',
  chain_eth_usdt: 'chain.eth.usdt_contract',
  chain_bsc_enabled: 'chain.bsc.enabled',
  chain_bsc_ws_url: 'chain.bsc.ws_url',
  chain_bsc_usdt: 'chain.bsc.usdt_contract',
  chain_btc_enabled: 'chain.btc.enabled',
  chain_btc_ws_url: 'chain.btc.ws_url',
  chain_btc_api_base: 'chain.btc.api_base',
  price_ttl: 'price_oracle.ttl_seconds',
  tg_enabled: 'telegram.enabled',
  tg_bot_token: 'telegram.bot_token',
  tg_chat_id: 'telegram.chat_id',
  tg_min_level: 'telegram.min_level',
  backfill_enabled: 'backfill.enabled',
  backfill_concurrency: 'backfill.concurrency',
  backfill_history_window: 'backfill.history_window',
  decoder_concurrency: 'workers.decoder_concurrency',
  rule_concurrency: 'workers.rule_concurrency',
  dashboard_port: 'dashboard.port',
} as const;

function flatten(cfg: RootConfig): Record<string, unknown> {
  return {
    [SETTINGS_KEYS.threshold_usdt]: cfg.threshold_usdt,
    [SETTINGS_KEYS.blacklist_cex]: cfg.blacklist_cex,
    [SETTINGS_KEYS.rule_sender_enabled]: cfg.rules.sender_repeats_to.enabled,
    [SETTINGS_KEYS.rule_sender_window]: cfg.rules.sender_repeats_to.window_size,
    [SETTINGS_KEYS.rule_receiver_enabled]: cfg.rules.receiver_repeats_from.enabled,
    [SETTINGS_KEYS.rule_receiver_window]: cfg.rules.receiver_repeats_from.window_size,
    [SETTINGS_KEYS.chain_eth_enabled]: cfg.chains.eth.enabled,
    [SETTINGS_KEYS.chain_eth_ws_url]: cfg.chains.eth.ws_url,
    [SETTINGS_KEYS.chain_eth_usdt]: cfg.chains.eth.usdt_contract,
    [SETTINGS_KEYS.chain_bsc_enabled]: cfg.chains.bsc.enabled,
    [SETTINGS_KEYS.chain_bsc_ws_url]: cfg.chains.bsc.ws_url,
    [SETTINGS_KEYS.chain_bsc_usdt]: cfg.chains.bsc.usdt_contract,
    [SETTINGS_KEYS.chain_btc_enabled]: cfg.chains.btc.enabled,
    [SETTINGS_KEYS.chain_btc_ws_url]: cfg.chains.btc.ws_url,
    [SETTINGS_KEYS.chain_btc_api_base]: cfg.chains.btc.api_base,
    [SETTINGS_KEYS.price_ttl]: cfg.price_oracle.ttl_seconds,
    [SETTINGS_KEYS.tg_enabled]: cfg.notifiers.telegram.enabled,
    [SETTINGS_KEYS.tg_bot_token]: cfg.notifiers.telegram.bot_token,
    [SETTINGS_KEYS.tg_chat_id]: cfg.notifiers.telegram.chat_id,
    [SETTINGS_KEYS.tg_min_level]: cfg.notifiers.telegram.min_level,
    [SETTINGS_KEYS.backfill_enabled]: cfg.backfill.enabled,
    [SETTINGS_KEYS.backfill_concurrency]: cfg.backfill.concurrency,
    [SETTINGS_KEYS.backfill_history_window]: cfg.backfill.history_window,
    [SETTINGS_KEYS.decoder_concurrency]: cfg.workers.decoder_concurrency,
    [SETTINGS_KEYS.rule_concurrency]: cfg.workers.rule_concurrency,
    [SETTINGS_KEYS.dashboard_port]: cfg.notifiers.dashboard.port,
  };
}

export function seedSettingsIfEmpty(cfg: RootConfig): void {
  const db = getDb();
  const flat = flatten(cfg);
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, 'seed')`,
  );
  const tx = db.transaction((entries: [string, unknown][]) => {
    for (const [k, v] of entries) insert.run(k, JSON.stringify(v), now);
  });
  tx(Object.entries(flat));
}

export function seedCexBlacklistIfEmpty(blacklistPath = './config/cex-blacklist.json'): void {
  if (!existsSync(resolve(blacklistPath))) return;
  const db = getDb();
  const existing = db.prepare(`SELECT COUNT(*) as n FROM address_lists WHERE list_type = 'cex_blacklist'`).get() as { n: number };
  if (existing.n > 0) return;
  const raw = JSON.parse(readFileSync(resolve(blacklistPath), 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO address_lists (list_type, chain, address, label, created_at) VALUES ('cex_blacklist', ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: Array<[string, string, string, number]>) => {
    for (const r of rows) insert.run(...r);
  });
  const rows: Array<[string, string, string, number]> = [];
  for (const [chain, entries] of Object.entries(raw)) {
    for (const e of entries as Array<{ address: string; label?: string }>) {
      rows.push([chain, e.address.toLowerCase(), e.label ?? '', now]);
    }
  }
  tx(rows);
  logger.info({ count: rows.length }, 'cex blacklist seeded');
}

// ---- runtime settings access ----

export function getSetting<T = unknown>(key: string, fallback?: T): T {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback as T;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback as T;
  }
}

export function getAllSettings(): Record<string, unknown> {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

export function setSetting(key: string, value: unknown, updatedBy = 'api'): void {
  const db = getDb();
  const json = JSON.stringify(value);
  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  const oldValue = existing?.value ?? null;
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  );
  const audit = db.prepare(
    `INSERT INTO settings_audit (key, old_value, new_value, updated_by, ts) VALUES (?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    upsert.run(key, json, now, updatedBy);
    audit.run(key, oldValue, json, updatedBy, now);
  });
  tx();
  bus.emit(EVENTS.ConfigChanged, { key, value });
}

export const SETTINGS = SETTINGS_KEYS;
