import { startDecoderWorker, stopDecoderWorker } from './decoder.js';
import { startRuleWorker, stopRuleWorker } from './rule.js';
import { closeQueues } from '../queues/index.js';

export { startDecoderWorker, startRuleWorker };

export async function stopWorkers(): Promise<void> {
  await Promise.allSettled([stopDecoderWorker(), stopRuleWorker()]);
  await closeQueues();
}
