import { EvmIngestor } from './evm.js';

export class EthIngestor extends EvmIngestor {
  constructor() {
    super('eth');
  }
}
