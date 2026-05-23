import { getDb } from '../storage/db.js';
import { getSetting, SETTINGS } from '../config.js';
import { bus, EVENTS, type AlertNewPayload } from '../utils/event-bus.js';
import { logger } from '../utils/logger.js';
import type { NormalizedTx } from '../types.js';
import { pushAndCheck } from './window-store.js';
import { isCexBlacklisted, isUserWhitelisted } from './blacklist.js';
import { scheduleBackfill } from './backfill.js';
import { getLabels } from '../labels/lookup.js';
import { assignSeverity } from '../notifiers/severity.js';
import { routeAlert } from '../notifiers/router.js';

function currentConfig() {
  return {
    threshold: getSetting<number>(SETTINGS.threshold_usdt, 100),
    senderEnabled: getSetting<boolean>(SETTINGS.rule_sender_enabled, true),
    senderWindow: getSetting<number>(SETTINGS.rule_sender_window, 5),
    receiverEnabled: getSetting<boolean>(SETTINGS.rule_receiver_enabled, true),
    receiverWindow: getSetting<number>(SETTINGS.rule_receiver_window, 5),
    blacklistOn: getSetting<boolean>(SETTINGS.blacklist_cex, true),
    backfillEnabled: getSetting<boolean>(SETTINGS.backfill_enabled, true),
  };
}

function storeTx(tx: NormalizedTx): boolean {
  const db = getDb();
  const res = db
    .prepare(
      `INSERT OR IGNORE INTO tx (chain, tx_hash, block_number, ts, from_addr, to_addr, token, amount_raw, amount_usdt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tx.chain,
      tx.txHash,
      tx.blockNumber,
      tx.timestamp,
      tx.from,
      tx.to,
      tx.token,
      tx.amountRaw,
      tx.amountUsdt,
    );
  return res.changes > 0;
}

function recordAlert(
  tx: NormalizedTx,
  rule: 'sender_repeats_to' | 'receiver_repeats_from',
  pivot: string,
  counterparty: string,
  windowTxHashes: string[],
): AlertNewPayload {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  // pivot is tx.from for sender rule, tx.to for receiver rule.
  // Look up full Label objects (with category + risk) for the snapshot;
  // tx.fromLabels/toLabels carry only label strings, so we re-query.
  const pivotFull = getLabels(tx.chain, pivot).map((l) => ({
    label: l.label, category: l.category, riskScore: l.riskScore,
  }));
  const cpFull = getLabels(tx.chain, counterparty).map((l) => ({
    label: l.label, category: l.category, riskScore: l.riskScore,
  }));
  const sev = assignSeverity({ amountUsdt: tx.amountUsdt, pivotLabels: pivotFull, counterpartyLabels: cpFull });
  const res = db
    .prepare(
      `INSERT INTO alerts (chain, rule, pivot_address, counterparty, trigger_tx_hash,
                           window_tx_hashes, amount_usdt, created_at,
                           pivot_labels, counterparty_labels, severity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tx.chain, rule, pivot, counterparty, tx.txHash,
      JSON.stringify(windowTxHashes), tx.amountUsdt, now,
      JSON.stringify(pivotFull), JSON.stringify(cpFull), sev,
    );
  const payload: AlertNewPayload = {
    id: Number(res.lastInsertRowid),
    chain: tx.chain,
    rule,
    pivotAddress: pivot,
    counterparty,
    triggerTxHash: tx.txHash,
    windowTxHashes,
    amountUsdt: tx.amountUsdt,
    createdAt: now,
    severity: sev,
    pivotLabels: pivotFull,
    counterpartyLabels: cpFull,
  };
  bus.emit(EVENTS.AlertNew, payload);
  void routeAlert(payload);
  return payload;
}

export async function onNormalizedTx(tx: NormalizedTx): Promise<void> {
  const cfg = currentConfig();
  if (tx.amountUsdt <= cfg.threshold) return;

  const stored = storeTx(tx);
  if (!stored) return; // dupe — already processed

  // 1) sender → repeated `to`
  if (cfg.senderEnabled) {
    const res = pushAndCheck(tx.chain, tx.from, 'out', tx.to, tx.txHash, cfg.senderWindow);
    if (res.hit && !tx.replay) {
      const skip = cfg.blacklistOn && isCexBlacklisted(tx.chain, tx.to);
      const whitelisted = isUserWhitelisted(tx.chain, tx.from) || isUserWhitelisted(tx.chain, tx.to);
      if (!skip && !whitelisted) {
        const alert = recordAlert(tx, 'sender_repeats_to', tx.from, tx.to, res.windowTxHashes);
        logger.info({ alert }, 'ALERT sender_repeats_to');
      }
    }
    if (cfg.backfillEnabled) scheduleBackfill(tx.chain, tx.from, 'out');
  }

  // 2) receiver ← repeated `from`
  if (cfg.receiverEnabled) {
    const res = pushAndCheck(tx.chain, tx.to, 'in', tx.from, tx.txHash, cfg.receiverWindow);
    if (res.hit && !tx.replay) {
      const skip = cfg.blacklistOn && isCexBlacklisted(tx.chain, tx.from);
      const whitelisted = isUserWhitelisted(tx.chain, tx.from) || isUserWhitelisted(tx.chain, tx.to);
      if (!skip && !whitelisted) {
        const alert = recordAlert(tx, 'receiver_repeats_from', tx.to, tx.from, res.windowTxHashes);
        logger.info({ alert }, 'ALERT receiver_repeats_from');
      }
    }
    if (cfg.backfillEnabled) scheduleBackfill(tx.chain, tx.to, 'in');
  }
}
