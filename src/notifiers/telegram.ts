import { bus, EVENTS, type AlertNewPayload, type ConfigChangedPayload } from '../utils/event-bus.js';
import { getSetting, SETTINGS } from '../config.js';
import { logger } from '../utils/logger.js';

// Lazy-loaded so missing token/disabled state doesn't pull the dep in tests.
type TelegramBotInstance = { sendMessage: (chatId: string, text: string, opts?: any) => Promise<unknown> };
let bot: TelegramBotInstance | null = null;
let started = false;

async function ensureBot(): Promise<TelegramBotInstance | null> {
  const enabled = getSetting<boolean>(SETTINGS.tg_enabled, false);
  const token = getSetting<string>(SETTINGS.tg_bot_token, '');
  if (!enabled || !token) {
    bot = null;
    return null;
  }
  if (bot) return bot;
  try {
    const mod = await import('node-telegram-bot-api');
    const Ctor = (mod as any).default ?? mod;
    bot = new Ctor(token, { polling: false }) as TelegramBotInstance;
    logger.info('telegram bot initialized');
    return bot;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'telegram bot init failed');
    bot = null;
    return null;
  }
}

function formatAlert(a: AlertNewPayload): string {
  const lines = [
    `*chain-watcher alert* [${a.severity}]`,
    `chain: ${a.chain}`,
    `rule: ${a.rule}`,
    `pivot: \`${a.pivotAddress}\``,
    `counterparty: \`${a.counterparty}\``,
    `trigger: \`${a.triggerTxHash}\``,
    `amount: ${a.amountUsdt.toFixed(2)} USDT`,
  ];
  return lines.join('\n');
}

const configListener = (p: ConfigChangedPayload) => {
  if (typeof p.key !== 'string') return;
  if (!p.key.startsWith('telegram.')) return;
  bot = null; // force re-init on next alert
};

export async function startTelegramNotifier(): Promise<void> {
  if (started) return;
  started = true;
  const { setChannelHandler } = await import('./router.js');
  setChannelHandler('tg', async (alert) => {
    const b = await ensureBot();
    if (!b) return;
    const chatId = getSetting<string>(SETTINGS.tg_chat_id, '');
    if (!chatId) return;
    try {
      await b.sendMessage(chatId, formatAlert(alert), { parse_mode: 'Markdown' });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'tg send failed');
    }
  });
  bus.on(EVENTS.ConfigChanged, configListener);
  await ensureBot();
}

export async function stopTelegramNotifier(): Promise<void> {
  if (!started) return;
  started = false;
  bus.off(EVENTS.ConfigChanged, configListener);
  bot = null;
}
