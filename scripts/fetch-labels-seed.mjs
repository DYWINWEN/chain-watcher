#!/usr/bin/env node
// One-shot helper: fetches per-chain label JSONs from brianleect/etherscan-labels,
// flattens to [{ address, label, category }, ...], and writes them to
// config/labels-seed/{eth,bsc}.json. Run manually after upstream updates.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = 'brianleect/etherscan-labels';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW = (p) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${p}`;

const CHAINS = {
  eth: { dir: 'data/etherscan/combined/' },
  bsc: { dir: 'data/bscscan/combined/' },
};

const EXCHANGE_RX = /Binance|OKX|Bybit|Coinbase|Kraken|Bitfinex|Bitstamp|Huobi|Gate\.io|Crypto\.com|KuCoin/i;
const MIXER_RX = /Tornado|Wasabi|JoinMarket|ChipMixer|Sinbad|MixerEnabled/i;
const BRIDGE_RX = /Stargate|cBridge|Wormhole|Across|Hop|Synapse|Multichain|Allbridge/i;

function classify(label) {
  if (EXCHANGE_RX.test(label)) return 'cex';
  if (MIXER_RX.test(label)) return 'mixer';
  if (BRIDGE_RX.test(label)) return 'bridge';
  return 'project';
}

async function listFiles(prefix) {
  const tree = await (await fetch(API)).json();
  return (tree.tree ?? [])
    .filter((e) => e.type === 'blob' && e.path.startsWith(prefix) && e.path.endsWith('.json'))
    .map((e) => e.path);
}

async function fetchOne(path) {
  const r = await fetch(RAW(path));
  if (!r.ok) {
    console.warn(`fetch ${path} → ${r.status}`);
    return [];
  }
  const json = await r.json();
  const out = [];
  // brianleect's "combined" files have shape: { "0xaddress": { name: "...", labels: [...] } }
  for (const [addr, meta] of Object.entries(json)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) continue;
    const label = meta?.name?.trim() || (meta?.labels?.[0] ?? '');
    if (!label) continue;
    out.push({ address: addr.toLowerCase(), label, category: classify(label) });
  }
  return out;
}

async function main() {
  mkdirSync('config/labels-seed', { recursive: true });
  for (const [chain, cfg] of Object.entries(CHAINS)) {
    console.log(`[${chain}] discovering files under ${cfg.dir}`);
    const files = await listFiles(cfg.dir);
    console.log(`[${chain}] ${files.length} files`);
    const all = [];
    for (const f of files) {
      const part = await fetchOne(f);
      all.push(...part);
    }
    // Dedup by (address, label).
    const seen = new Set();
    const dedup = [];
    for (const r of all) {
      const k = `${r.address}|${r.label}`;
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(r);
    }
    const outPath = join('config/labels-seed', `${chain}.json`);
    writeFileSync(outPath, JSON.stringify(dedup));
    console.log(`[${chain}] wrote ${dedup.length} rows → ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
