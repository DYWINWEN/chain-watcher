import type { AlertNewPayload } from '../utils/event-bus.js';

const shortAddr = (h: string): string =>
  typeof h === 'string' && h.length > 14 ? `${h.slice(0, 10)}…${h.slice(-4)}` : h;

const labelString = (labels: AlertNewPayload['pivotLabels']): string =>
  labels && labels.length > 0 ? ` (${labels.map((l) => l.label).join(', ')})` : '';

/** Plain text — Telegram fallback, Webhook generic. */
export function formatPlain(a: AlertNewPayload): string {
  return [
    `[${a.severity}] chain-watcher alert`,
    `chain: ${a.chain}`,
    `rule: ${a.rule}`,
    `pivot: ${shortAddr(a.pivotAddress)}${labelString(a.pivotLabels)}`,
    `counterparty: ${shortAddr(a.counterparty)}${labelString(a.counterpartyLabels)}`,
    `amount: ${a.amountUsdt.toFixed(2)} USDT`,
    `trigger: ${shortAddr(a.triggerTxHash)}`,
  ].join('\n');
}

/** Markdown — Telegram (parse_mode=Markdown), Discord (descriptions support some markdown). */
export function formatMarkdown(a: AlertNewPayload): string {
  return [
    `*[${a.severity}] chain-watcher alert*`,
    `chain: \`${a.chain}\``,
    `rule: \`${a.rule}\``,
    `pivot: \`${shortAddr(a.pivotAddress)}\`${labelString(a.pivotLabels)}`,
    `counterparty: \`${shortAddr(a.counterparty)}\`${labelString(a.counterpartyLabels)}`,
    `amount: *${a.amountUsdt.toFixed(2)} USDT*`,
    `trigger: \`${shortAddr(a.triggerTxHash)}\``,
  ].join('\n');
}

/** Slack Block Kit. */
export function formatSlackBlocks(a: AlertNewPayload): { blocks: any[] } {
  const labelsLine = (ls: AlertNewPayload['pivotLabels']) =>
    ls && ls.length > 0 ? ` _(${ls.map((l) => l.label).join(', ')})_` : '';
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `[${a.severity}] chain-watcher alert` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Chain:* ${a.chain}` },
          { type: 'mrkdwn', text: `*Rule:* ${a.rule}` },
          { type: 'mrkdwn', text: `*Amount:* ${a.amountUsdt.toFixed(2)} USDT` },
          { type: 'mrkdwn', text: `*Tx:* \`${shortAddr(a.triggerTxHash)}\`` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*Pivot:* \`${shortAddr(a.pivotAddress)}\`${labelsLine(a.pivotLabels)}\n` +
            `*Counterparty:* \`${shortAddr(a.counterparty)}\`${labelsLine(a.counterpartyLabels)}`,
        },
      },
    ],
  };
}
