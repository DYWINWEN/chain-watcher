// Replay captured RawEvent[] from a JSON file through the local pipeline. No Redis required.
//
// Usage: pnpm tsx scripts/replay.ts ./fixtures/eth-block-N.json
//
// File format: [{ kind: 'evm-transfer' | 'btc-vout', chain, txHash, ... }, ...]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'dotenv/config';
import { getDb, closeDb } from '../src/storage/db.js';
import { loadSeedConfig, seedSettingsIfEmpty, seedCexBlacklistIfEmpty, setSetting, SETTINGS } from '../src/config.js';
import { decode } from '../src/decoder/index.js';
import { onNormalizedTx } from '../src/rules/engine.js';
import { logger } from '../src/utils/logger.js';
import type { RawEvent } from '../src/types.js';

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: pnpm tsx scripts/replay.ts <file.json>');
    process.exit(2);
  }
  getDb();
  seedSettingsIfEmpty(loadSeedConfig());
  seedCexBlacklistIfEmpty();
  // Replay should never hit live RPCs.
  setSetting(SETTINGS.backfill_enabled, false, 'replay');

  const events = JSON.parse(readFileSync(resolve(arg), 'utf8')) as RawEvent[];
  logger.info({ file: arg, count: events.length }, 'replay start');
  for (const ev of events) {
    const tx = await decode(ev);
    await onNormalizedTx(tx);
  }
  const alerts = getDb().prepare('SELECT COUNT(*) AS n FROM alerts').get() as { n: number };
  logger.info({ alerts: alerts.n }, 'replay done');
  closeDb();
}

main().catch((err) => {
  logger.fatal({ err }, 'replay failed');
  process.exit(1);
});
