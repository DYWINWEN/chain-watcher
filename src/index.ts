import 'dotenv/config';
import { join } from 'node:path';
import { logger } from './utils/logger.js';
import { getDb, closeDb } from './storage/db.js';
import { loadSeedConfig, seedSettingsIfEmpty, seedCexBlacklistIfEmpty, getSetting, SETTINGS } from './config.js';
import { startIngestors, stopIngestors } from './ingestors/index.js';
import { startDecoderWorker, startRuleWorker, stopWorkers } from './workers/index.js';
import { startDashboard, stopDashboard } from './dashboard/server.js';
import { startTelegramNotifier, stopTelegramNotifier } from './notifiers/telegram.js';
import { seedEtherscanLabels } from './labels/importer.js';
import { startOfacRefresher } from './labels/refresher.js';

async function main(): Promise<void> {
  getDb();
  const seed = loadSeedConfig();
  seedSettingsIfEmpty(seed);
  seedCexBlacklistIfEmpty();

  logger.info(
    {
      threshold_usdt: getSetting(SETTINGS.threshold_usdt),
      chains: {
        eth: getSetting(SETTINGS.chain_eth_enabled),
        bsc: getSetting(SETTINGS.chain_bsc_enabled),
        btc: getSetting(SETTINGS.chain_btc_enabled),
      },
    },
    'chain-watcher up',
  );

  // M10: labels — seed the vendored etherscan-labels snapshot (no-op if already seeded)
  // and kick off the OFAC SDN refresher (stale-on-boot + 24h interval).
  const seedDir = join(process.cwd(), 'config', 'labels-seed');
  seedEtherscanLabels('eth', join(seedDir, 'eth.json'));
  seedEtherscanLabels('bsc', join(seedDir, 'bsc.json'));

  const { seedSubscriptionsIfEmpty } = await import('./notifiers/router.js');
  seedSubscriptionsIfEmpty();

  startOfacRefresher();

  await startDecoderWorker();
  await startRuleWorker();
  await startIngestors();
  await startDashboard();
  await startTelegramNotifier();

  const shutdown = async (sig: string) => {
    logger.warn({ sig }, 'shutting down');
    await Promise.allSettled([stopIngestors(), stopWorkers(), stopDashboard(), stopTelegramNotifier()]);
    const { stopOfacRefresher } = await import('./labels/refresher.js');
    stopOfacRefresher();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
