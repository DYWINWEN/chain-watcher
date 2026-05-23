import { getSetting, SETTINGS } from '../config.js';
import { bus, EVENTS, type ConfigChangedPayload } from '../utils/event-bus.js';
import { logger } from '../utils/logger.js';
import type { Ingestor } from './base.js';
import { EthIngestor } from './eth.js';
import { BscIngestor } from './bsc.js';
import { BtcIngestor } from './btc.js';
import { EvmMempoolIngestor } from './mempool.js';

const active = new Map<string, Ingestor>();

let mempoolEth: EvmMempoolIngestor | null = null;

function shouldRun(chain: 'eth' | 'bsc' | 'btc'): boolean {
  const key =
    chain === 'eth' ? SETTINGS.chain_eth_enabled :
    chain === 'bsc' ? SETTINGS.chain_bsc_enabled :
    SETTINGS.chain_btc_enabled;
  return !!getSetting<boolean>(key, true);
}

function makeIngestor(chain: 'eth' | 'bsc' | 'btc'): Ingestor {
  if (chain === 'eth') return new EthIngestor();
  if (chain === 'bsc') return new BscIngestor();
  return new BtcIngestor();
}

function startOne(chain: 'eth' | 'bsc' | 'btc'): void {
  if (active.has(chain)) return;
  if (!shouldRun(chain)) {
    logger.info({ chain }, 'ingestor disabled');
    return;
  }
  const ing = makeIngestor(chain);
  active.set(chain, ing);
  void ing.start().catch((err) => logger.error({ chain, err: (err as Error).message }, 'ingestor crashed'));
}

async function stopOne(chain: 'eth' | 'bsc' | 'btc'): Promise<void> {
  const ing = active.get(chain);
  if (!ing) return;
  await ing.stop();
  active.delete(chain);
}

const configListener = (payload: ConfigChangedPayload) => {
  if (typeof payload.key !== 'string') return;
  const m = payload.key.match(/^chain\.(eth|bsc|btc)\.enabled$/);
  if (!m) return;
  const chain = m[1] as 'eth' | 'bsc' | 'btc';
  if (payload.value) startOne(chain);
  else void stopOne(chain);
};

export async function startIngestors(): Promise<void> {
  bus.on(EVENTS.ConfigChanged, configListener);
  startOne('eth');
  startOne('bsc');
  startOne('btc');
  // M15: ETH mempool ingestor (gated by mempool.enabled; connect() throws when disabled)
  mempoolEth = new EvmMempoolIngestor('eth');
  void mempoolEth.start();
}

export async function stopIngestors(): Promise<void> {
  bus.off(EVENTS.ConfigChanged, configListener);
  await Promise.allSettled([...active.keys()].map((c) => stopOne(c as 'eth' | 'bsc' | 'btc')));
  if (mempoolEth) {
    await mempoolEth.stop();
    mempoolEth = null;
  }
}
