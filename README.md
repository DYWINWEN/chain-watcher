# chain-watcher

Real-time monitor for large USDT transfers (>$100) on **ETH / BSC / BTC** that flags addresses whose last 5 large transfers all go to (or come from) the same counterparty. Local SQLite + Express dashboard, Telegram optional.

See `PLAN.md` for the design rationale.

## Quickstart (local)

```bash
docker run -d --name cw-redis -p 6379:6379 redis:7-alpine
cp .env.example .env && $EDITOR .env   # fill RPC URLs
pnpm install
pnpm dev
open http://localhost:8787
```

Pages:

- `/alerts` — live alert stream (SSE)
- `/watchlist` — look up rolling windows for an address
- `/stats` — alert volume by chain (7d) + tx totals
- `/settings` — every analysis parameter editable; saves take effect immediately

## Architecture

```
Ingestors (eth/bsc/btc) → BullMQ raw-tx → Decoder (+price) → BullMQ normalized-tx → RuleEngine → SQLite
                                                                                       ↓
                                                                   EventBus → SSE → Dashboard
                                                                            → Telegram (optional)
```

Runtime config lives in SQLite `settings`; `config/rules.yaml` only seeds first launch. All edits go through the dashboard `PATCH /api/settings/:key`, get audited, and broadcast `config:changed` so ingestors/rules/notifiers hot-reload without a process restart.

## Tests

```bash
pnpm test
```

Vitest unit coverage for: window store, BTC change heuristic, rule engine bidirectional hits, blacklist, price oracle cache.

## Replay mode

```bash
pnpm tsx scripts/replay.ts ./fixtures/eth-block-N.json
```

Reads an array of `RawEvent` JSON entries and feeds them straight through the decoder + rule engine (no Redis required). Handy for regression-testing rule changes against a captured block.
