import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let pushAndCheck: typeof import('../src/rules/window-store.js').pushAndCheck;

beforeEach(async () => {
  vi.resetModules();
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'cw-')), 'cw.db');
  ({ pushAndCheck } = await import('../src/rules/window-store.js'));
});

describe('pushAndCheck', () => {
  it('keeps at most N entries', () => {
    for (let i = 0; i < 7; i++) {
      pushAndCheck('eth', '0xa', 'out', `0xcp${i}`, `tx${i}`, 5);
    }
    const r = pushAndCheck('eth', '0xa', 'out', `0xcp7`, `tx7`, 5);
    expect(r.counterparties).toHaveLength(5);
    expect(r.counterparties[0]).toBe('0xcp3');
    expect(r.counterparties[4]).toBe('0xcp7');
  });

  it('hits when last 5 counterparties are identical', () => {
    let last;
    for (let i = 0; i < 5; i++) {
      last = pushAndCheck('bsc', '0xb', 'in', '0xsame', `t${i}`, 5);
    }
    expect(last!.hit).toBe(true);
    expect(last!.windowTxHashes).toHaveLength(5);
  });

  it('does not hit when one counterparty differs inside the window', () => {
    // 0xother lands at index 1 of a 5-wide window; window must roll forward
    // by 2 more entries before that contamination shifts out.
    pushAndCheck('bsc', '0xb', 'in', '0xsame', 't0', 5);
    pushAndCheck('bsc', '0xb', 'in', '0xother', 't1', 5);
    for (let i = 2; i < 5; i++) pushAndCheck('bsc', '0xb', 'in', '0xsame', `t${i}`, 5);
    expect(pushAndCheck('bsc', '0xb', 'in', '0xsame', 't5', 5).hit).toBe(false); // 0xother still at idx 0
    expect(pushAndCheck('bsc', '0xb', 'in', '0xsame', 't6', 5).hit).toBe(true);  // window is now all 0xsame
  });

  it('never hits with window_size=1', () => {
    const r = pushAndCheck('eth', '0xc', 'out', '0xany', 't0', 1);
    expect(r.hit).toBe(false);
  });
});
