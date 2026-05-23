import { getDb } from '../storage/db.js';
import { getSetting, SETTINGS } from '../config.js';
import { bus, EVENTS, type AlertNewPayload } from '../utils/event-bus.js';
import { logger } from '../utils/logger.js';
import type { NormalizedTx } from '../types.js';
import { pushAndCheck } from './window-store.js';
import { isCexBlacklisted, isUserWhitelisted } from './blacklist.js';
import { scheduleBackfill } from './backfill.js';
import { getLabels } from '../labels/lookup.js';
import { routeAlert } from '../notifiers/router.js';
import { getCompiledRules } from './rule-loader.js';
import { pickFrequencyCounter } from './frequency-counter.js';
import { connection } from '../queues/index.js';
import type { CompiledRule } from './dsl/compile.js';
import type { EvalDeps } from './dsl/ast.js';

let depsCache: EvalDeps | null = null;

async function deps(): Promise<EvalDeps> {
  if (depsCache) return depsCache;
  const freq = await pickFrequencyCounter(connection);
  depsCache = {
    freq,
    getLabels,
    pushAndCheckWindow: pushAndCheck,
  };
  return depsCache;
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
  rule: CompiledRule,
  pivot: string,
  counterparty: string,
): AlertNewPayload {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const pivotFull = getLabels(tx.chain, pivot).map((l) => ({ label: l.label, category: l.category, riskScore: l.riskScore }));
  const cpFull = getLabels(tx.chain, counterparty).map((l) => ({ label: l.label, category: l.category, riskScore: l.riskScore }));
  const finalSev = rule.severity;
  const source = tx.source ?? 'block';
  const status = source === 'mempool' ? 'pending' : 'confirmed';
  const confirmedBlock = source === 'block' ? tx.blockNumber : null;

  const res = db
    .prepare(
      `INSERT INTO alerts (chain, rule, pivot_address, counterparty, trigger_tx_hash,
                           window_tx_hashes, amount_usdt, created_at,
                           pivot_labels, counterparty_labels, severity, rule_id,
                           status, source, confirmed_block)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      tx.chain, rule.id, pivot, counterparty, tx.txHash,
      '[]', tx.amountUsdt, now,
      JSON.stringify(pivotFull), JSON.stringify(cpFull), finalSev, rule.id,
      status, source, confirmedBlock,
    );

  const newAlertId = Number(res.lastInsertRowid);

  if (source === 'mempool') {
    // Upsert mempool_pending row
    db.prepare(
      `INSERT INTO mempool_pending (chain, tx_hash, first_seen, first_seen_block, alert_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(chain, tx_hash) DO UPDATE SET alert_count = alert_count + 1`,
    ).run(tx.chain, tx.txHash, now, tx.blockNumber); // tx.blockNumber is 0 for mempool — that's fine; sweeper uses head separately
  } else {
    // source === 'block' — flip any pending alerts for this tx_hash
    const pendingRows = db
      .prepare(
        `SELECT id FROM alerts WHERE trigger_tx_hash = ? AND status = 'pending'`,
      )
      .all(tx.txHash) as Array<{ id: number }>;
    if (pendingRows.length > 0) {
      const flip = db.prepare(
        `UPDATE alerts SET status = 'confirmed', confirmed_block = ? WHERE id = ?`,
      );
      const insertAction = db.prepare(
        `INSERT INTO alert_actions (alert_id, action, actor, ts) VALUES (?, 'confirmed', 'system', ?)`,
      );
      for (const r of pendingRows) {
        flip.run(tx.blockNumber, r.id);
        insertAction.run(r.id, now);
        bus.emit(EVENTS.AlertConfirmed, { id: r.id, confirmedBlock: tx.blockNumber });
      }
      db.prepare(
        `UPDATE mempool_pending SET confirmed_block = ? WHERE chain = ? AND tx_hash = ?`,
      ).run(tx.blockNumber, tx.chain, tx.txHash);
    }
  }

  const payload: AlertNewPayload = {
    id: newAlertId,
    chain: tx.chain,
    rule: rule.id,
    pivotAddress: pivot,
    counterparty,
    triggerTxHash: tx.txHash,
    windowTxHashes: [],
    amountUsdt: tx.amountUsdt,
    createdAt: now,
    pivotLabels: pivotFull,
    counterpartyLabels: cpFull,
    severity: finalSev,
  };
  bus.emit(EVENTS.AlertNew, payload);
  void routeAlert(payload);
  return payload;
}

export async function onNormalizedTx(tx: NormalizedTx): Promise<void> {
  if (tx.amountUsdt <= getSetting<number>(SETTINGS.threshold_usdt, 100)) return;

  const stored = storeTx(tx);
  if (!stored) return; // dupe — already processed

  const evalDeps = await deps();
  const rules = getCompiledRules();
  for (const rule of rules) {
    let hit = false;
    try {
      hit = await rule.evaluate(tx, evalDeps);
    } catch (err) {
      logger.warn({ err: (err as Error).message, ruleId: rule.id }, 'rule eval error');
      continue;
    }
    if (!hit || tx.replay) continue;

    // For repeat_* rules, re-derive pivot/counterparty from the rule's first condition.
    const firstCond = rule.raw.when[0];
    let pivot = tx.from;
    let counterparty = tx.to;
    if (firstCond && 'type' in firstCond && firstCond.type === 'repeat_from_same') {
      pivot = tx.to;
      counterparty = tx.from;
    }

    // Existing blacklist + whitelist gate stays.
    const blacklistOn = getSetting<boolean>(SETTINGS.blacklist_cex, true);
    const skip = blacklistOn && isCexBlacklisted(tx.chain, counterparty);
    const whitelisted = isUserWhitelisted(tx.chain, tx.from) || isUserWhitelisted(tx.chain, tx.to);
    if (skip || whitelisted) continue;

    const alert = recordAlert(tx, rule, pivot, counterparty);
    logger.info({ alert }, `ALERT ${rule.id}`);

    // Update fire_count + last_fired_at (best-effort)
    try {
      const now = Math.floor(Date.now() / 1000);
      getDb().prepare(`UPDATE rules SET fire_count = fire_count + 1, last_fired_at = ? WHERE id = ?`).run(now, rule.id);
    } catch { /* swallow */ }
  }

  // Frequency feed: every above-threshold tx contributes to both group_by buckets
  // so future frequency conditions can count it. Fire-and-forget.
  void evalDeps.freq.add(tx.chain, `from_addr:${tx.from}`, tx.timestamp, tx.txHash);
  void evalDeps.freq.add(tx.chain, `to_addr:${tx.to}`, tx.timestamp, tx.txHash);

  // Backfill schedule for both sides — unchanged from v1
  if (getSetting<boolean>(SETTINGS.backfill_enabled, true)) {
    scheduleBackfill(tx.chain, tx.from, 'out');
    scheduleBackfill(tx.chain, tx.to, 'in');
  }
}
