import { parseStringPromise } from 'xml2js';
import { logger } from '../utils/logger.js';
import type { Chain } from '../types.js';
import type { Category, Label, Source } from './types.js';
import { CATEGORY_RISK } from './score.js';

type SdnRow = Omit<Label, 'createdAt' | 'updatedAt'>;

const CURRENCY_TO_CHAIN: Record<string, Chain | undefined> = {
  ETH: 'eth',
  ETC: undefined,
  XBT: 'btc',
  BTC: 'btc',
  BSC: 'bsc',
};

/**
 * Treasury SDN XML → label rows. Only entries that have at least one
 * Digital Currency Address are returned. ETH addresses are lowercased.
 * BTC addresses keep their original case (segwit/bech32 are case-sensitive).
 */
export async function parseOfacSdn(xml: string): Promise<SdnRow[]> {
  let doc: any;
  try {
    doc = await parseStringPromise(xml, { explicitArray: true });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'parseOfacSdn: XML parse failed');
    return [];
  }
  const entries = doc?.sdnList?.sdnEntry ?? [];
  const out: SdnRow[] = [];
  for (const e of entries) {
    const name = String(e?.lastName?.[0] ?? '').trim();
    if (!name) continue;
    const idList = e?.idList?.[0]?.id ?? [];
    for (const id of idList) {
      const idType = String(id?.idType?.[0] ?? '');
      const idNumber = String(id?.idNumber?.[0] ?? '').trim();
      if (!idType.startsWith('Digital Currency Address') || !idNumber) continue;
      const currency = idType.replace(/^Digital Currency Address\s*-\s*/i, '').trim();
      const chain = CURRENCY_TO_CHAIN[currency];
      if (!chain) continue;
      const address = chain === 'btc' ? idNumber : idNumber.toLowerCase();
      out.push({
        chain,
        address,
        label: name,
        category: 'ofac',
        source: 'ofac_sdn' as Source,
        riskScore: CATEGORY_RISK['ofac' as Category],
      });
    }
  }
  return out;
}
