import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { sendToWebhook } from '../src/notifiers/webhook.js';

const sampleAlert = {
  id: 1,
  chain: 'eth' as const,
  rule: 'sender_repeats_to' as const,
  pivotAddress: '0xa',
  counterparty: '0xb',
  triggerTxHash: '0xt',
  windowTxHashes: [],
  amountUsdt: 1000,
  createdAt: 0,
  severity: 'P2' as const,
  pivotLabels: [],
  counterpartyLabels: [],
};

let server: Server;
let port: number;
let receivedBodies: any[] = [];
let nextStatus = 200;

beforeEach(async () => {
  receivedBodies = [];
  nextStatus = 200;
  const app = express();
  app.use(express.json());
  app.post('/hook', (req, res) => {
    receivedBodies.push(req.body);
    res.status(nextStatus).send(nextStatus === 200 ? 'ok' : 'fail');
  });
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterEach(() => new Promise<void>((r) => server.close(() => r())));

describe('sendToWebhook', () => {
  it('POSTs the alert as JSON on success', async () => {
    await sendToWebhook(sampleAlert, { url: `http://127.0.0.1:${port}/hook` });
    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0]).toMatchObject({
      severity: 'P2',
      chain: 'eth',
      amountUsdt: 1000,
    });
  });

  it('throws on non-2xx (caller decides retry)', async () => {
    nextStatus = 500;
    await expect(sendToWebhook(sampleAlert, { url: `http://127.0.0.1:${port}/hook` })).rejects.toThrow();
  });

  it('no-op when url is missing', async () => {
    await sendToWebhook(sampleAlert, {});
    expect(receivedBodies).toHaveLength(0);
  });
});
