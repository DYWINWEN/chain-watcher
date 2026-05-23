import type { Chain } from '../types.js';

export type Category = 'ofac' | 'sanctions' | 'mixer' | 'cex' | 'bridge' | 'project' | 'user';

export type Source = 'ofac_sdn' | 'etherscan-labels' | 'user' | 'auto';

export type Label = {
  chain: Chain;
  address: string;
  label: string;
  category: Category;
  source: Source;
  riskScore: number;
  createdAt: number;
  updatedAt: number;
};

export type LabelSourceStatus = {
  source: Source;
  lastFetchedAt: number | null;
  rowCount: number;
  status: 'ok' | 'error' | 'pending';
  lastError: string | null;
};
