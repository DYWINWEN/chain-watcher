import type { Response } from 'express';
import { bus, EVENTS, type AlertNewPayload, type ConfigChangedPayload } from '../utils/event-bus.js';

const clients = new Set<Response>();

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // client gone; cleanup is on close
    }
  }
}

let wired = false;
function ensureBusWired(): void {
  if (wired) return;
  wired = true;
  bus.on(EVENTS.AlertNew, (p: AlertNewPayload) => broadcast('alert', p));
  bus.on(EVENTS.ConfigChanged, (p: ConfigChangedPayload) => broadcast('config', p));
}

export function attachSseClient(res: Response): void {
  ensureBusWired();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
  clients.add(res);

  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      // ignore
    }
  }, 25_000);

  res.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function clientCount(): number {
  return clients.size;
}
