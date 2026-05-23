import { getDb } from '../storage/db.js';
import type { Chain } from '../types.js';

export function isCexBlacklisted(chain: Chain, address: string): boolean {
  const db = getDb();
  const addr = address.toLowerCase();
  const row = db
    .prepare(
      `SELECT 1 FROM address_lists
        WHERE list_type = 'cex_blacklist'
          AND address = ?
          AND (chain = ? OR chain = '*')
        LIMIT 1`,
    )
    .get(addr, chain);
  return !!row;
}

export function isUserWhitelisted(chain: Chain, address: string): boolean {
  const db = getDb();
  const addr = address.toLowerCase();
  const row = db
    .prepare(
      `SELECT 1 FROM address_lists
        WHERE list_type = 'user_whitelist'
          AND address = ?
          AND (chain = ? OR chain = '*')
        LIMIT 1`,
    )
    .get(addr, chain);
  return !!row;
}
