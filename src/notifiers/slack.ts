import type { AlertNewPayload } from '../utils/event-bus.js';
import { formatSlackBlocks } from './format.js';

export type SlackConfig = {
  webhookUrl?: string;
  timeoutMs?: number;
};

export async function sendToSlack(alert: AlertNewPayload, config: SlackConfig): Promise<void> {
  if (!config.webhookUrl) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 5000);
  try {
    const body = formatSlackBlocks(alert);
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`slack webhook → ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
