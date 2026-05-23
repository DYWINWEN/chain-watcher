import 'dotenv/config';
import { logger } from './utils/logger.js';
import { getDb, closeDb } from './storage/db.js';
import { loadSeedConfig, seedSettingsIfEmpty, seedCexBlacklistIfEmpty, getSetting, SETTINGS } from './config.js';
import { startIngestors, stopIngestors } from './ingestors/index.js';
import { startDecoderWorker, startRuleWorker, stopWorkers } from './workers/index.js';
import { startDashboard, stopDashboard } from './dashboard/server.js';
import { startTelegramNotifier, stopTelegramNotifier } from './notifiers/telegram.js';

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

  await startDecoderWorker();
  await startRuleWorker();
  await startIngestors();
  await startDashboard();
  await startTelegramNotifier();

  const shutdown = async (sig: string) => {
    logger.warn({ sig }, 'shutting down');
    await Promise.allSettled([stopIngestors(), stopWorkers(), stopDashboard(), stopTelegramNotifier()]);
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
