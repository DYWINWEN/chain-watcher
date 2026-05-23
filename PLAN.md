# chain-watcher：BSC/BTC/ETH 大额重复转账实时告警工具

## Context

需要一个本机 Node.js + TypeScript 工具，**实时**监控 BSC、BTC、ETH 三条链上的 USDT 大额转账（单笔等价 USDT > 100），并识别"地址近期 5 笔转账都指向同一对手方"的可疑资金归集/分发模式，用于链上交易数据分析与实时告警。

目标用户是运维/研究者本人（mima1111），首要场景是**实时告警/信号**：发现命中模式后立刻在本地 Web Dashboard 上看到，并写入 SQLite 留档以便后续复盘；高优先级命中可选推送到 Telegram。

为什么要做：现有的链上分析平台（Arkham、Nansen）要么贵要么不让自定义规则，自建一个轻量管道可以按需迭代规则、长期沉淀数据。本期先做最小骨架并在本机跑通端到端流程，后续视效果决定是否上 VM。

---

## 决策回顾（已与用户对齐）

| 项 | 决定 |
|---|---|
| 用途 | 实时告警/信号 |
| 监控链 | BSC + BTC + ETH |
| 阈值 | 单笔等价 USDT > 100 |
| BTC 范围 | 原生转账（按 Binance 实时价换算 USDT 估值），不做 Omni |
| 规则 | 双向可配置：① 发送方最近 5 笔 >100USDT 全部到同一接收方；② 接收方最近 5 笔 >100USDT 全部来自同一发送方 |
| 数据源 | 免费公共 RPC + 自建解析（Ankr/PublicNode WebSocket、mempool.space WS） |
| 价格源 | Binance 公共 API 实时价 |
| 通道 | 本地 SQLite + Express Web Dashboard（主）+ Telegram（高优先级可选） |
| 参数调整 | **所有分析参数在 Web Dashboard 上可调**（阈值、窗口大小、规则方向开关、链开关、黑/白名单、TG 开关），改完即时生效，无需重启 |
| 滑动窗口 | 本机为活跃地址维护 + 首次见到时异步回填历史 5 笔 |
| 黑名单 | 内置 CEX 热钱包名单（避免交易所提币被误报） |
| 架构 | 分层（Ingestor/Decoder/RuleEngine/Storage/UI）+ BullMQ on Redis |
| 技术栈 | Node.js + TypeScript |
| 部署 | 本机 macOS 调试，本期不上服务器 |

---

## 架构

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ EthIngestor  │ │ BscIngestor  │ │ BtcIngestor  │
│ ws+ethers v6 │ │ ws+ethers v6 │ │ mempool.space│
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┴────┬───────────┘
                             ▼
                  BullMQ queue: raw-tx
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Decoder + PriceOracle│  ← Binance /ticker/price
                  │ → NormalizedTx       │
                  │ (filter >100 USDT)   │
                  └──────────┬───────────┘
                             ▼
                  ┌─────────────────────┐
                  │   RuleEngine         │
                  │ - 双向滑动窗口       │
                  │ - 黑名单过滤         │
                  │ - 首次见到回填       │  ← eth_getLogs / Blockstream
                  └──────────┬───────────┘
                             ▼
                  ┌─────────────────────┐
                  │ SQLite (WAL mode)    │
                  │ tx / windows / alerts│
                  └──────────┬───────────┘
                             ▼
                  ┌─────────────────────┐
                  │ Express + SSE        │
                  │ Dashboard            │
                  └──────────────────────┘
                             │ (高优先级)
                             ▼
                       Telegram Bot
```

**统一数据模型**

```ts
type NormalizedTx = {
  chain: 'eth' | 'bsc' | 'btc';
  txHash: string;
  blockNumber: number;
  timestamp: number;          // unix seconds
  from: string;
  to: string;
  token: 'USDT' | 'BTC';
  amountRaw: string;          // bigint string
  amountUsdt: number;
};

type Alert = {
  id: number;
  triggeredBy: NormalizedTx;
  rule: 'sender_repeats_to' | 'receiver_repeats_from';
  pivotAddress: string;       // 发送方或接收方
  counterparty: string;       // 重复对手方
  windowTxHashes: string[];   // 触发窗口里 5 笔的 hash
  createdAt: number;
};
```

---

## 项目结构

```
chain-watcher/
├── package.json
├── tsconfig.json
├── .env.example                    # RPC URL、Redis URL、TG token
├── config/
│   ├── rules.yaml                  # 阈值、方向开关、白/黑名单
│   └── cex-blacklist.json          # 内置 CEX 热钱包名单
├── src/
│   ├── index.ts                    # 入口：启动所有组件
│   ├── config.ts                   # 配置加载与校验
│   ├── ingestors/
│   │   ├── base.ts                 # 重连、心跳、lastBlock 持久化
│   │   ├── eth.ts
│   │   ├── bsc.ts
│   │   └── btc.ts
│   ├── decoder/
│   │   ├── erc20.ts                # Transfer 事件解码（USDT）
│   │   ├── btc.ts                  # vin/vout 解析
│   │   └── price-oracle.ts         # Binance ticker，60s 缓存
│   ├── rules/
│   │   ├── engine.ts               # 双向窗口判定主流程
│   │   ├── window-store.ts         # SQLite-backed 滑动窗口
│   │   └── backfill.ts             # 首次见到时拉历史 5 笔
│   ├── storage/
│   │   ├── db.ts                   # better-sqlite3 单例 + 迁移
│   │   └── schema.sql
│   ├── notifiers/
│   │   ├── telegram.ts             # 可选
│   │   └── sse-bus.ts              # Dashboard 实时推流
│   ├── dashboard/
│   │   ├── server.ts               # Express
│   │   └── public/                 # 静态 HTML + 少量 JS
│   └── utils/
│       ├── logger.ts               # pino
│       └── reconnect.ts            # 指数退避
└── README.md
```

### 数据库 schema 要点

```sql
CREATE TABLE tx (
  chain TEXT, tx_hash TEXT, block_number INTEGER,
  ts INTEGER, from_addr TEXT, to_addr TEXT,
  token TEXT, amount_raw TEXT, amount_usdt REAL,
  PRIMARY KEY (chain, tx_hash)
);
CREATE INDEX idx_tx_from ON tx(chain, from_addr, ts DESC);
CREATE INDEX idx_tx_to   ON tx(chain, to_addr,   ts DESC);

CREATE TABLE windows (
  chain TEXT, address TEXT, direction TEXT,  -- 'out' or 'in'
  counterparties TEXT,                       -- JSON array of last 5
  last_tx_hashes TEXT,                       -- JSON array of last 5 hashes
  updated_at INTEGER,
  backfilled INTEGER DEFAULT 0,
  PRIMARY KEY (chain, address, direction)
);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain TEXT, rule TEXT,
  pivot_address TEXT, counterparty TEXT,
  trigger_tx_hash TEXT, window_tx_hashes TEXT,
  amount_usdt REAL, created_at INTEGER
);
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);

CREATE TABLE checkpoints (
  chain TEXT PRIMARY KEY,
  last_block INTEGER,
  updated_at INTEGER
);
```

### 配置存储方式（**新增**）

`config/rules.yaml` 仅作为**首次启动的 seed**。运行时所有参数存在 SQLite 的 `settings` 表里，Dashboard 改完直接写回 SQLite 并通过内部 EventEmitter 广播 `config:changed` 事件，各组件订阅后热更新；不需要重启进程。

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,        -- e.g. 'threshold_usdt', 'rule.sender_repeats_to.enabled'
  value TEXT NOT NULL,         -- JSON 编码
  updated_at INTEGER,
  updated_by TEXT              -- 'seed' | 'dashboard' | 'api'
);

CREATE TABLE address_lists (
  list_type TEXT,              -- 'cex_blacklist' | 'user_whitelist' | 'user_blacklist'
  chain TEXT,                  -- 'eth' | 'bsc' | 'btc' | '*'
  address TEXT,
  label TEXT,                  -- 可选注释，例如 'Binance Hot 14'
  created_at INTEGER,
  PRIMARY KEY (list_type, chain, address)
);
```

### Dashboard 设置页（**新增**）

新增 `/settings` 页面，分组展示并实时编辑：

| 分组 | 可调字段 |
|---|---|
| **告警阈值** | `threshold_usdt`（单笔金额阈值，默认 100） |
| **规则开关** | `sender_repeats_to.enabled`、`sender_repeats_to.window_size`、`receiver_repeats_from.enabled`、`receiver_repeats_from.window_size`（1–20 整数） |
| **链开关** | 每条链独立 `enabled`、`ws_url`、`usdt_contract`（EVM 链） |
| **黑/白名单** | `cex_blacklist` 总开关 + 名单 CRUD（按链 + 地址 + 备注） + 用户自定义白名单/黑名单 |
| **通知** | `telegram.enabled`、`bot_token`、`chat_id`、最低告警级别 |
| **价格源** | Binance symbol 映射、缓存 TTL |

UI 交互：
- 每个字段就地编辑（input/toggle/textarea），失焦自动保存
- 顶部一条 "最近变更" 流：谁、什么字段、旧值→新值、何时
- 危险操作（清空名单、切换链 ws_url）有二次确认
- 后端用 `PATCH /api/settings/:key`，写库后 emit `config:changed`，RuleEngine/Ingestors/Notifier 订阅热更新

### 规则配置示例（`config/rules.yaml` — 仅 seed）

```yaml
threshold_usdt: 100
rules:
  sender_repeats_to:
    enabled: true
    window_size: 5
  receiver_repeats_from:
    enabled: true
    window_size: 5
blacklist_cex: true              # 命中链上对手方在 CEX 热钱包名单则忽略
chains:
  eth:
    enabled: true
    ws_url: ${ETH_WS_URL}
    usdt_contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
  bsc:
    enabled: true
    ws_url: ${BSC_WS_URL}
    usdt_contract: "0x55d398326f99059fF775485246999027B3197955"
  btc:
    enabled: true
    api_base: "https://mempool.space/api"
    ws_url: "wss://mempool.space/api/v1/ws"
notifiers:
  dashboard: { enabled: true, port: 8787 }
  telegram:  { enabled: false, bot_token: ${TG_BOT_TOKEN}, chat_id: ${TG_CHAT_ID} }
```

---

## 实施分阶段（建议 writing-plans 阶段细化）

**M0 - 项目骨架（半天）**
- `pnpm init`、TS 配置、ESLint/Prettier、pino logger、env loader
- SQLite schema + 迁移、Redis 本机起 docker container

**M1 - 单链贯通（ETH）（1-2 天）**
- EthIngestor：`ethers.WebSocketProvider` 订阅 USDT Transfer 日志
- Decoder：amount/decimals 换算、价格 oracle stub（USDT≈1）
- RuleEngine：单向规则 + 内存窗口先跑通
- SQLite 写入、CLI 输出命中

**M2 - 引入 Redis + 标准化数据流（1 天）**
- BullMQ 接管 Ingestor → Decoder → RuleEngine 之间的传递
- 把窗口存到 SQLite 表，重启不丢

**M3 - BSC 接入（半天）**
- 复用 ETH 路径，换 RPC URL + USDT 合约地址

**M4 - BTC 接入（1-2 天）**
- BtcIngestor：mempool.space WS 订阅区块
- Decoder：解析 vout，按 Binance BTC/USDT 实时价换算
- 注意 UTXO 模型下"from/to"取 vin[0] 推断地址 + 每个 vout 一条 NormalizedTx

**M5 - 双向规则 + 回填（1 天）**
- 第二条规则启用、首次见到时调 `eth_getLogs` 或 `/address/{addr}/txs` 回填窗口
- CEX 黑名单接入

**M6 - Dashboard + Telegram（1.5 天）**
- Express 四页：`/alerts` 实时流（SSE）、`/watchlist` 活跃地址窗口、`/stats` 每小时命中数、`/settings` 参数热调
- `settings` 表 + `config:changed` 事件总线，各组件热更新订阅
- 参数变更审计流（谁、改了什么、新旧值）
- Telegram bot 推送（可选）

**M7 - 健壮性打磨（持续）**
- WebSocket 重连指数退避、RPC 限速控制、断点续传
- 集成测试（dry-run 模式：从本地区块文件回放）

---

## 关键复用与外部依赖

需要新装的 npm 包：
- `ethers@^6` - EVM RPC + 事件解码
- `bullmq` + `ioredis` - 队列
- `better-sqlite3` - 同步 SQLite，对单进程最简单
- `express` + `eventsource` - Dashboard + SSE
- `pino` + `pino-pretty` - 日志
- `node-telegram-bot-api` - TG 推送（可选加载）
- `js-yaml` + `zod` - 配置加载与校验
- `ws` - mempool.space WebSocket

价格源 API（无需 SDK，直接 fetch）：
- `https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT`

公共 RPC 端点（在 `.env.example` 备好备用）：
- ETH: `wss://ethereum-rpc.publicnode.com`、`wss://eth.drpc.org`
- BSC: `wss://bsc-rpc.publicnode.com`、`wss://bsc.drpc.org`
- BTC: `wss://mempool.space/api/v1/ws`

CEX 黑名单初始来源：手工整理 Binance/OKX/Bybit/Coinbase 公开的热钱包前 10 个地址（每链一份 JSON）。

---

## 验证方法（端到端）

**本机启动**：
```bash
docker run -d --name cw-redis -p 6379:6379 redis:7-alpine
cp .env.example .env && $EDITOR .env
pnpm install
pnpm dev                    # 启动所有组件
open http://localhost:8787  # 查看 Dashboard
```

**功能验证**：
1. **大额过滤**：盯 1 分钟日志，确认只有 amount_usdt > 100 的交易进入 `tx` 表（用 `sqlite3 data/cw.db 'select count(*), min(amount_usdt) from tx'` 核对）。
2. **三链覆盖**：`select chain, count(*) from tx group by chain` 三条链都有数据。
3. **窗口维护**：选一个活跃地址，查 `windows` 表，确认 `counterparties` JSON 数组长度始终 ≤ 5 且按时间倒序。
4. **规则命中**：写一个种子脚本预先往 `tx` 和 `windows` 写入 5 笔同一对手方的伪数据，触发一笔新交易看 `alerts` 表是否写入对应记录、Dashboard 是否实时刷新。
5. **回填**：清空 `windows` 表后重启，命中 >100USDT 的交易触发首次见到逻辑，10 秒内 `backfilled=1` 且 `counterparties` 已填充。
6. **重连**：手动 `docker pause cw-redis` 30 秒再 resume，检查 Ingestor 是否自动重连且 `checkpoints` 表 `last_block` 单调递增不回退。
7. **价格**：在 Decoder 单元测试里 mock Binance 返回值，断言 BTC vout 0.005 BTC 在价格 60000 USDT 时换算为 300 USDT。
8. **参数热调**：Dashboard 上把 `threshold_usdt` 从 100 改成 1000，立刻观察 RuleEngine 日志确认下一笔 200 USDT 的交易不再写入 `tx` 表；把它改回 100 后又恢复入库。改窗口大小 5→3、关掉 `sender_repeats_to` 规则后同样实时生效。

**性能基准**（非阻塞）：
- 三链同时跑 24 小时不崩、SQLite 体积 < 500 MB、平均命中告警延迟（区块确认到 Dashboard）< 5 秒。

---

## 已知风险与边界

- **公共 RPC 限速**：免费节点容易被限速或断流。设计上每条链支持多个 ws URL 轮换；如果实际跑下来太不稳，预留切换到 Alchemy 免费档的余地（只需改 ws_url）。
- **BTC 价格波动**：Binance 单一价源，60 秒缓存可能让边界值 (~100 USDT) 误判。可接受 —— 这个阈值本身就是软门槛，目的是过粉尘。
- **历史回填限速**：首次见到爆发期，可能短时间内发多次 RPC 请求；用 p-limit 限并发到 2。
- **CEX 黑名单维护**：交易所热钱包会迁移，名单需要定期更新（初版手工维护即可）。
- **MEV/三明治**：链上还有 sandwich/arbitrage bot 转账噪音，本期不处理；规则演进时再加 mempool 启发式。
- **不做的事**：跨链关联分析、链上身份归属、合约调用分析、Token approval 监控 —— 都是后续可扩展方向，本期严格不超纲。
