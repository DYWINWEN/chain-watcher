import type { AlertNewPayload } from '../utils/event-bus.js';
import { formatMarkdown } from './format.js';

export type DiscordConfig = {
  webhookUrl?: string;
  timeoutMs?: number;
};

const SEV_COLOR: Record<string, number> = {
  P1: 0xf87171, // red
  P2: 0xfacc15, // yellow
  P3: 0xa78bfa, // purple
};

export async function sendToDiscord(alert: AlertNewPayload, config: DiscordConfig): Promise<void> {
  if (!config.webhookUrl) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 5000);
  try {
    const body = {
      embeds: [
        {
          title: `chain-watcher alert [${alert.severity}]`,
          description: formatMarkdown(alert),
          color: SEV_COLOR[alert.severity] ?? 0x71717a,
          timestamp: new Date(alert.createdAt * 1000).toISOString(),
        },
      ],
    };
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`discord webhook → ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
