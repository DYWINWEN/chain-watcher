import type { AlertNewPayload } from '../utils/event-bus.js';

export type WebhookConfig = {
  url?: string;
  timeoutMs?: number;
};

/** POSTs the AlertNewPayload as JSON to config.url. Throws on network error
 *  or non-2xx response so the router can log it. */
export async function sendToWebhook(alert: AlertNewPayload, config: WebhookConfig): Promise<void> {
  if (!config.url) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeoutMs ?? 5000);
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`webhook ${config.url} → ${res.status} ${res.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
