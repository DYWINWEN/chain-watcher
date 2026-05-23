import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseOfacSdn } from '../src/labels/importer.js';

let xml: string;
beforeAll(() => {
  const p = new URL('../fixtures/sdn-sample.xml', import.meta.url);
  xml = readFileSync(p, 'utf8');
});

describe('parseOfacSdn', () => {
  it('extracts ETH addresses from Digital Currency Address entries', async () => {
    const rows = await parseOfacSdn(xml);
    const eth = rows.filter((r) => r.chain === 'eth');
    expect(eth.map((r) => r.address)).toEqual([
      '0x8589427373d6d84e98730d7795d8f6f8731fda16',
      '0x722122df12d4e14e13ac3b6895a86e84145b6967',
    ]);
  });

  it('extracts BTC addresses (XBT) with original case', async () => {
    const rows = await parseOfacSdn(xml);
    const btc = rows.filter((r) => r.chain === 'btc');
    expect(btc).toHaveLength(1);
    expect(btc[0].address).toBe('bc1q2sftpvr6cz4xptdgnxztj8njs4u96lvuuqyq6t');
  });

  it('attaches the SDN entity name as the primary label', async () => {
    const rows = await parseOfacSdn(xml);
    expect(rows.some((r) => r.label === 'TORNADO.CASH')).toBe(true);
    expect(rows.some((r) => r.label === 'HYDRA MARKET')).toBe(true);
  });

  it('every parsed row has category ofac + source ofac_sdn + risk 95', async () => {
    const rows = await parseOfacSdn(xml);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.category).toBe('ofac');
      expect(r.source).toBe('ofac_sdn');
      expect(r.riskScore).toBe(95);
    }
  });

  it('skips sdnEntry that has no Digital Currency Address children', async () => {
    const rows = await parseOfacSdn(xml);
    expect(rows.every((r) => r.label !== 'Doe')).toBe(true);
  });

  it('returns [] on malformed input rather than throwing', async () => {
    const rows = await parseOfacSdn('<<<not xml>>>');
    expect(rows).toEqual([]);
  });
});
