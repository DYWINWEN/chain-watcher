# chain-watcher v2 设计文档

**日期**：2026-05-23
**作者**：mima1111 与 Claude (Opus 4.7) 协作
**前置**：`PLAN.md` （v1 设计） + `feat/chain-watcher-impl` 分支（v1 实现，PR #1）
**适用分支**：本设计落地后将作为 v2 的 base，后续 `feat/v2-*` 一系列 PR 围绕本文件展开

---

## 1. Context

v1 已经在 `feat/chain-watcher-impl` 上完整实现并通过单元测试（15/15）：BSC/BTC/ETH USDT >100 转账实时监控 + 双向 5 笔同对手方告警 + SQLite + Express+SSE Dashboard + 参数热调 + 可选 Telegram。

代码 review 与差距分析（详见对话历史）发现：

- **5 个真实 bug**（其中 1 个高危：receiver_repeats_from 规则的黑名单查错边）
- **3 个 plan 已承诺但未交付**（多 ws URL 轮换、LOG_LEVEL env、DB migrations 目录）
- **Dashboard UI 对操作员体验不足**：无过滤/搜索/分页/抽屉、硬编码主题、非响应式
- 用户期望 8 项新功能：自定义规则、标签体系、告警分级、关系图、多 RPC 轮换、多通道推送、Mempool 监控、Tron/Polygon 多链

v2 的目标是**用一套 spec 把以上全部覆盖**，但**实施分 10 个独立 milestone**，每个 milestone 单独 PR、可独立 merge、不互相阻塞。

**为什么现在做 v2**：v1 是 "走通"，v2 是 "好用"。如果不补 UI / 自定义规则 / 关系图，工具的可玩性和场景覆盖会被两条硬编码规则锁死；如果不补多通道 / 多 RPC，可靠性吃免费节点的亏；如果不补标签 / 分级，告警长期会被噪音淹没。

---

## 2. Goals & Non-Goals

**Goals**

- 修复 v1 全部已知 bug，把测试覆盖率从 15 提升到 30+ 用例
- Dashboard 全面重设计为 Linear/Vercel 风（亮色 + 暗色双主题），所有页面响应式，所有参数可视编辑
- 引入自定义规则引擎，把"硬编码 2 条规则"变成"无限条 DSL 规则 + 默认 2 条 seed"
- 引入标签体系（CEX hot wallet / OFAC SDN / Mixer / 用户自定义）作为规则和告警的一等公民
- 引入告警分级（P1/P2/P3）+ 通道订阅矩阵 + 静默规则
- 推送通道从 Telegram 单一扩到 Telegram + Webhook + Discord + Slack（带重试队列）
- 引入 Mempool pending tx 监控（EVM 优先）+ reorg 撤回逻辑
- 引入地址关系网络图可视化（pivot + 2 度对手方）
- 横向扩链：Tron USDT-TRC20 + Polygon EVM USDT

**Non-Goals (v2 不做)**

- **Solana / SPL Token** —— 结构差异大（账户模型 + SPL token program + RPC 范式），单独立项 v3 评估
- **跨链关联分析** —— 同一资金在不同链间桥接的追踪，等 v3
- **AML 风险分（heuristic score）** —— 标签体系铺好后 v3 再叠
- **历史完整回放/时间机器** —— 现在 `scripts/replay.ts` 够用，不做 UI 时间机器
- **告警导出 CSV / PDF 报表** —— 等用户提出再说，YAGNI

---

## 3. UI 视觉方向（Linear / Vercel 风）

定调通过 Pencil 三套候选 demo 对比后选定（详见 `design/demo[1-3]-*.png`）：

- **底色**：暗色 `#0a0a0b` + 灰阶卡片 `#101015` / `#16161b`（亮色主题后续叠加）
- **品牌色**：紫色 `#5b6cff` / `#a78bfa` / `#c4b5fd`（accent 渐变）
- **链色**：ETH `#a78bfa` · BSC `#facc15` · BTC `#fb923c` · TRX `#ef4444` · MATIC `#8b5cf6`
- **状态色**：success `#22c55e` · warning `#facc15` · danger `#f87171`
- **字体**：UI `Inter`，hash/数字 `JetBrains Mono`
- **半径**：卡片 `12-14`，输入 `8-10`，pill `999`（全圆）
- **间距**：4 / 8 / 10 / 14 / 18 / 24 / 28 八档
- **影子**：仅 hover / modal，平时 0
- **导航**：左侧 220px 固定 sidebar（lucide 图标 + label + 红色数字徽标）
- **响应式**：≥1280 双栏（sidebar+content）；768-1279 sidebar 收为 64px icon-only；<768 sidebar 转底部 tab bar

### 已交付 mockup（在 `design/chain-watcher-ui-demos.pen` 中）

1. `Demo2/Linear-Vercel` —— **Alerts** 页基线（5 张告警卡 + filter chip + 实时灯）
2. `Page/Watchlist` —— **Watchlist + 关系图** 页（含 risk score 4 卡 + Cytoscape 风的 pivot→repeat receiver→hop2 网络图）
3. `Page/Rules` —— **Rules** 页（toggle + WHEN/AND/THEN DSL + 条件 chip + 输出通道 footer）

### 待 implementation 阶段细化的页面

- `Page/Stats` —— 时间区间选择器 + 多维 chart（按 chain / rule / amount 分布 / 命中频率 heatmap）
- `Page/Settings` —— 现有参数 + 新增分级矩阵 + 通道订阅
- `Page/Labels` —— 标签 CRUD + 批量导入 OFAC/CEX JSON
- 全局：address detail drawer（点任一地址打开右侧 drawer，三 tab：windows / alerts / counterparties）

---

## 4. 架构演进

v1 的分层架构（Ingestor → BullMQ → Decoder+Oracle → RuleEngine → SQLite → Dashboard）整体保留，v2 在以下点上扩展：

```
                                   ┌─ Confirmed block stream (existing)
EvmIngestor / BtcIngestor / *──────┤
TronIngestor (new) / PolyIngestor──┤
                                   └─ Mempool stream (new, EVM only)
       │
       ▼  RawEvent { source: 'block'|'mempool', ... }
BullMQ raw-tx queue (existing)
       │
       ▼
Decoder + PriceOracle (existing) + LabelLookup (new, attaches tags)
       │
       ▼  NormalizedTx { ..., fromLabels[], toLabels[] }
RuleEngine v2 (NEW)
  ├── Built-in: sender_repeats_to, receiver_repeats_from (existing)
  └── Custom: user-defined DSL rules from `rules` table (NEW)
       │
       ▼  Alert { severity, rule, ... }
SubscriptionRouter (NEW) ── 按 severity / chain / address 决定走哪些通道
       │
       ├─→ TelegramNotifier (existing, hardened)
       ├─→ WebhookNotifier (NEW)
       ├─→ DiscordNotifier (NEW)
       ├─→ SlackNotifier (NEW)
       └─→ SSE bus (existing) ── 写 Dashboard
       │
       ▼
SQLite (existing) + 新表：rules / labels / subscriptions / mempool_pending / alert_severity_log
```

**关键新增组件**：

- `src/labels/` —— `LabelLookup`（地址 → 标签集合，10s in-memory cache）+ `LabelImporter`（OFAC SDN JSON / CEX hot wallet CSV）
- `src/rules/dsl.ts` —— 规则 DSL 解析器（YAML/JSON）+ zod schema 校验 + AST 求值器（pure function `(NormalizedTx, ctx) → AlertCandidate | null`）
- `src/notifiers/router.ts` —— SubscriptionRouter，决定 alert 走哪些通道
- `src/notifiers/{webhook,discord,slack}.ts` —— 三个新通道，复用同一个 retry queue（BullMQ）
- `src/ingestors/mempool.ts` —— EVM pending tx 订阅（`eth_subscribe newPendingTransactions`）
- `src/ingestors/tron.ts` —— TronGrid WS（USDT-TRC20 Transfer 事件解码）
- `src/ingestors/polygon.ts` —— 复用 `evm.ts` 仅换 RPC + USDT 合约
- `src/utils/rpc-pool.ts` —— 多 RPC URL 轮换 + 探活
- `src/api/graph.ts` —— 关系图 API，BFS depth=2

---

## 5. 数据库变更

新增 5 张表（migration 文件 `src/storage/migrations/v2_001_*.sql`）：

```sql
-- 自定义规则
CREATE TABLE rules (
  id TEXT PRIMARY KEY,              -- 'mixer_outflow_burst'
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  severity TEXT NOT NULL,           -- 'P1' | 'P2' | 'P3'
  dsl TEXT NOT NULL,                -- JSON-encoded rule DSL
  built_in INTEGER NOT NULL DEFAULT 0,
  notify_channels TEXT NOT NULL DEFAULT '[]', -- JSON ['tg', 'webhook:prod']
  created_at INTEGER, updated_at INTEGER, updated_by TEXT
);

-- 地址标签
CREATE TABLE labels (
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT NOT NULL,              -- 'OFAC' | 'Tornado.Cash' | 'Binance Hot 14'
  category TEXT NOT NULL,           -- 'cex' | 'mixer' | 'sanctions' | 'project' | 'user'
  source TEXT NOT NULL,             -- 'ofac_sdn' | 'arkham' | 'user' | 'auto'
  risk_score INTEGER,               -- 0-100
  created_at INTEGER,
  PRIMARY KEY (chain, address, label)
);
CREATE INDEX idx_labels_addr ON labels(chain, address);
CREATE INDEX idx_labels_cat  ON labels(category);

-- 通道订阅矩阵（severity × channel × silence）
CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,            -- 'tg' | 'webhook' | 'discord' | 'slack'
  min_severity TEXT NOT NULL,       -- 'P1' / 'P2' / 'P3'
  chain_filter TEXT,                -- NULL=all, or JSON array
  rule_filter TEXT,                 -- NULL=all, or JSON array of rule_id
  silence_until INTEGER,            -- unix ts, NULL=active
  config TEXT NOT NULL,             -- JSON: bot_token/chat_id/webhook_url/etc
  enabled INTEGER NOT NULL DEFAULT 1
);

-- Mempool pending 缓冲（reorg 时需要撤回）
CREATE TABLE mempool_pending (
  chain TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  alert_id INTEGER,                 -- 关联 alerts.id（如果触发了告警）
  first_seen INTEGER NOT NULL,
  confirmed_block INTEGER,          -- NULL = 还未确认
  dropped INTEGER NOT NULL DEFAULT 0, -- 1 = 被 reorg 丢弃
  PRIMARY KEY (chain, tx_hash)
);

-- 告警状态轨迹（reorg 撤回 / 用户标记假阳性 / 静默）
CREATE TABLE alert_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL,
  action TEXT NOT NULL,             -- 'reorg_drop' | 'mark_fp' | 'silence' | 'ack'
  actor TEXT NOT NULL,              -- 'system' | dashboard user
  note TEXT,
  ts INTEGER NOT NULL,
  FOREIGN KEY (alert_id) REFERENCES alerts(id)
);
```

`alerts` 表新增 `severity TEXT NOT NULL DEFAULT 'P2'` 列（向后兼容 default P2）。

---

## 6. 自定义规则 DSL（M14 的核心）

设计目标：表达力够覆盖 80% 风控场景，但不要 Turing-complete（避免 sandbox 安全黑洞）。

格式：YAML（人写）+ JSON（API 存）+ zod 强类型校验。

```yaml
id: mixer_outflow_burst
name: "Mixer outflow burst"
severity: P1
enabled: true
notify: [tg, "webhook:prod"]
when:                              # all of these must be true
  - { field: amount_usdt, op: ">", value: 500 }
  - { field: direction, op: "in", value: ["out", "in"] }   # any direction
  - { type: frequency,
      window_minutes: 10,
      min_count: 3,
      group_by: from_addr }
  - { type: counterparty_label,
      side: to,                    # the receiving address
      labels_any: ["mixer", "ofac"] }
then:
  emit_alert: true
```

**支持的字段**：`amount_usdt`、`amount_raw`、`chain`、`direction (sender|receiver)`、`from_addr`、`to_addr`、`token`、`block_number`、`timestamp`、`from_labels[]`、`to_labels[]`、`source (block|mempool)`

**支持的运算符**：`>`、`<`、`>=`、`<=`、`==`、`!=`、`in`、`not_in`、`contains`、`matches (regex)`

**支持的复合条件类型**：
- `frequency`：滑动时间窗内某字段相同的事件计数
- `counterparty_label`：对手方有/无某类标签
- `repeat_to_same`：连续 N 笔到同一对手方（覆盖现有 sender_repeats_to）
- `repeat_from_same`：连续 N 笔来自同一对手方（覆盖 receiver_repeats_from）

**求值流程**：每条 NormalizedTx 进入 RuleEngine 后，对**所有 enabled rules** 跑一遍 AST 求值，符合即生成 AlertCandidate（携带 severity）。多条规则可同时命中，分别记录。

**UI**：Rules 页（mockup 已出）—— 卡片展示，每张卡顶部 toggle + 名称 + severity tag + 文字 DSL 预览 + 条件 chip + footer（输出通道 + 命中计数）。点击 "Edit conditions" 打开 drawer 走可视化条件编辑器（不是 raw YAML 编辑，那是给高级用户的 "advanced" tab）。

---

## 7. 实施里程碑（10 个，按推荐顺序）

每个 milestone = 1 个独立 PR = 可独立 merge / rollback。

### M8 — Bugfix sweep · 0.5d · 🐛 低风险

修复 v1 review 发现的 5 个 bug：

1. `src/rules/engine.ts:98-101` —— receiver_repeats_from 规则的黑名单 / 白名单检查侧反了。修复：用 `tx.from` 检查（接收方汇聚资金的来源是发送方）。
2. `src/ingestors/evm.ts:86-95` —— checkpoint 保存在 filter attach 前。修复：将 `saveCheckpoint` 移到 `handleLog` 成功后。
3. `src/rules/backfill.ts:80` —— `zeroPadValue` 不校验地址格式。修复：前置 `ethers.isAddress(address)` 校验。
4. `src/rules/window-store.ts:88` —— `windowSize === 1` 永远不 hit。修复：config 加 `z.number().int().min(2).max(20)`。
5. `package.json` + 新增 `eslint.config.js` —— eslint v9 flat config 迁移，删除 `.eslintrc.cjs`。

测试：每个 bug 加 1 个 regression 用例。

### M9 — Infra 收尾 · 0.5d · 🏗 低风险

- 多 ws URL 轮换：`src/utils/rpc-pool.ts` 实现 round-robin + health check + 自动 failover。每个 chain 配置变为数组 `ws_urls: string[]`。
- `LOG_LEVEL` env：`src/utils/logger.ts` 读 `process.env.LOG_LEVEL`，默认 `info`。
- `src/storage/migrations/` 真正落地一个最小框架（迁移由文件名版本号控制，run 一次后写入 `_migrations` 表）。

### M10 — 标签体系 · 1d · 🏷 低风险

- 新建 `src/labels/lookup.ts`（10s in-memory cache by `(chain, address)`）+ `src/labels/importer.ts`（OFAC SDN XML/JSON 解析 + CEX hot wallet CSV）
- 新建 API：`GET/POST/DELETE /api/labels`，`POST /api/labels/import` 接受文件上传
- Decoder 输出的 `NormalizedTx` 增加 `fromLabels: string[]` / `toLabels: string[]` 字段
- Alerts 页 chip 渲染地址旁标签（已 mock）
- 启动时自动拉 OFAC SDN 列表（每天一次更新）

### M11 — UI 重设计 (Linear) · 2-3d · 🎨 中风险

- 前端栈不变（vanilla JS + CSS），新增设计 tokens（CSS vars: `--bg`, `--card`, `--accent-*`, `--chain-*`...)
- 新建 `src/dashboard/public/css/tokens.css` + `tokens-dark.css` + `tokens-light.css`
- 改写 `app.js`：模块化（`pages/alerts.js`, `pages/watchlist.js`, ...），加 SPA-lite 路由（hash-based）
- 实现：filter bar（chain / amount / time / rule 多选）、search（`Ctrl+K`）、地址 drawer（点任一地址 → 右侧 360px 抽屉）、toast notification、light/dark 切换、响应式断点
- 完成 mock 之外的三页：Stats / Settings / Labels（用 mocked 风格延续）

### M12 — 告警分级 + 订阅 · 1.5d · 📐 低风险

- `alerts` 表加 `severity` 列；现有两条 built-in 规则默认 P2
- 新建 `src/notifiers/router.ts`：根据 `subscriptions` 表决定 alert 走哪些通道
- Settings 页加 "通道订阅" 矩阵 UI（severity × channel × on/off + min_severity slider）
- 静默：按 chain / address / rule_id 设置 silence_until（短期 1h / 24h / forever）

### M13 — 多通道推送 · 1d · 🔀 低风险

- `src/notifiers/webhook.ts` —— 自定义 POST URL，JSON body schema 文档化
- `src/notifiers/discord.ts` —— Discord webhook embed 模板
- `src/notifiers/slack.ts` —— Slack incoming webhook block kit 模板
- 所有通道共享 `notifications` BullMQ queue：失败 3 次指数退避，超 3 次入死信表 `notification_dlq`
- Telegram notifier 也接入该队列（替换 v1 的 fire-and-forget）

### M14 — 自定义规则引擎 · 3d · 🧩 高风险

- `src/rules/dsl.ts`：zod schema + AST 解析（详见 §6）
- `src/rules/engine.ts` 重构：现有 2 条规则作为 built-in seed，与 user-defined 规则同 channel 跑
- frequency 滑动窗：用 SQLite 实时查 `tx` 表 + index 优化（已有 `idx_tx_from`/`idx_tx_to`）
- API：`GET/POST/PUT/DELETE /api/rules`，热加载（emit `rule:changed` 事件，engine subscribed）
- UI：Rules 页（mock 已出）+ Drawer 形式的可视化条件编辑器（拖拽 chip 不是 raw YAML）
- 单测：≥10 个 fixture 规则 + golden tx 验证命中/未命中

### M15 — Mempool 监控 · 2d · 🔍 高风险

- `src/ingestors/mempool.ts`：EVM 的 `eth_subscribe newPendingTransactions` + `eth_getTransactionByHash` 取详情
- 公共节点对 pending 的覆盖率不一致（Ankr OK，PublicNode 偶尔丢）——多源 ingest + 自去重
- Reorg 处理：mempool 触发的 alert 写入 `mempool_pending` 表；后续区块若该 tx 未确认（被替换/丢弃），通过 `alert_actions` 记 `reorg_drop` 并 SSE 推一条 "撤回" 事件
- Dashboard alerts 行加 `pending` / `confirmed` / `dropped` 三态徽标

### M16 — 多链 Tron + Polygon · 1.5d · 🌐 中风险

- Polygon：复用 `src/ingestors/evm.ts`，新增 `src/ingestors/polygon.ts`（只换 RPC URL + USDT 合约 `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`）
- Tron：新建 `src/ingestors/tron.ts`，用 TronGrid WS（`wss://api.trongrid.io/jsonrpc`）或 HTTP poll（`POST /wallet/gettransactioninfobyid`）
- Tron USDT-TRC20 合约 `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`，decimals=6
- Price oracle 加 `TRXUSDT` / `MATICUSDT` symbol（Binance API 都有）
- Decoder 增加 Tron-specific 解码（不同的事件序列化格式）
- 配置 + UI 增加这两个链的 enable/disable

### M17 — 关系网络图 · 2d · 🕸 中风险

- 后端 API `GET /api/graph?address=X&depth=2&limit=20`：返回 `{ nodes: [...], edges: [...] }`，BFS depth 2
- 节点字段：`{ id, chain, address, labels, risk_score, tx_count }`
- 边字段：`{ source, target, count, total_usdt, is_repeat_edge }`
- 前端：Cytoscape.js（轻量，~80KB gz），自定义 layout = `cose`
- Watchlist 页底部嵌入图（mock 已出）+ Alerts 抽屉里点 "Open graph" → 弹出全屏图模态
- 节点 hover tooltip / 点击展开下一层

---

## 8. 关键复用与新依赖

**新增 npm 依赖**：
- `cytoscape@^3.30.x` —— 关系图前端（M17）
- `cytoscape-cose-bilkent@^4.x` —— layout 算法
- `xml2js` —— OFAC SDN XML 解析（M10）
- 无其他新增；其他需求复用 v1 已有 (ethers / bullmq / better-sqlite3 / zod / etc.)

**外部数据源**：
- OFAC SDN：`https://www.treasury.gov/ofac/downloads/sdn.xml`（每日刷新）
- CEX 热钱包名单：手工维护 `config/cex-hot-wallets.json`（初版 ~50 个）
- TronGrid：`https://api.trongrid.io/`（每秒 15 个免费请求）
- Polygon RPC：`wss://polygon-rpc.publicnode.com`、`wss://polygon-bor.publicnode.com`（轮换）

**复用 v1 已有**：所有 ingestor / decoder / 窗口管理 / SSE / 设置热调机制 / better-sqlite3 单例 / pino logger / graceful shutdown / migration scaffolding。

---

## 9. 验证方法

每个 milestone 自带验证脚本和测试用例。整体 v2 完成后：

**端到端联调**（在本机 macOS）：
1. `pnpm install && pnpm migrate && pnpm dev`，三链同时跑（ETH/BSC/BTC + 可选 Polygon/Tron）
2. Dashboard `localhost:8787` 切换 light/dark / 4 个断点（1920/1280/768/375）每个都能正常用
3. 创建一条自定义规则（mock 里那条 mixer_outflow_burst），用 `scripts/replay.ts` 喂 5 笔触发的 fixture，看 Dashboard 收到 P1 alert + Telegram 收到推送
4. Mempool：故意让一笔 pending 不打包（用 anvil 本地节点模拟），观察 30s 后 SSE 收到 `reorg_drop` 事件，Dashboard alert 标记变 `dropped`
5. 标签：导入 OFAC SDN，找一笔触发 alert 的地址，确认 chip 显示 "OFAC SDN"
6. 网络图：Watchlist 页搜一个活跃地址，二阶展开看到 hop 2 节点
7. 多通道：subscriptions 表添加 Discord webhook，触发 P1 后确认 Discord 频道收到 embed
8. Tron + Polygon：每个链 24h 至少 1 笔 >$100 入 `tx` 表

**性能基准**（不阻塞 v2，但要监测）：
- 三链 + Mempool 同时跑 24h，p95 alert latency（pending → SSE）< 8s
- SQLite 体积 7d 后 < 1GB
- 内存常驻 < 500MB

---

## 10. 已知风险与缓解

| 风险 | 缓解 |
|---|---|
| 公共节点 mempool 数据不全 | 多源 ingest + 去重 + 文档里明说 "Mempool 是 best-effort" |
| Reorg 撤回逻辑复杂，容易丢一致性 | 撤回写 `alert_actions` 表而非 DELETE，留审计；UI 不消失只标 dropped |
| 自定义规则 DSL 表达力 vs 安全 | 不 Turing-complete，所有运算符列白名单，AST 求值器 pure function 无副作用 |
| TronGrid 限速 | 缓存 + p-limit(5)；超额自动降级到 HTTP poll |
| OFAC SDN 更新跳号 / 假阳性 | 每日抓取 diff，加白名单 override（user_whitelist 优先级最高） |
| 关系图 BFS 在 hub 节点（Binance Hot）爆炸 | `limit=20`/层 + 标签为 cex 的节点不再展开（标记为 "leaf"） |
| UI 重设计期间老 UI 不能用 | 旧 `app.js` 保留 `app-v1.js`，URL `?v=1` 触发 fallback；M11 merge 后两版并行 1 周再删 |

---

## 11. Out of scope，后续 v3 候选

- Solana SPL token 支持
- 跨链桥接资金追踪（Wormhole / LayerZero / cBridge）
- AML 风险打分（基于 graph + label 推 0-100 score）
- 告警 CSV / PDF 导出 + 邮件日报
- 历史回放 UI（时间机器）
- 多用户 / RBAC（目前是单人工具）
- 移动端原生 app（PWA 应该够用）

---

## 12. 文件结构变化预览（v2 完成后）

```
chain-watcher/
├── PLAN.md                       (v1 旧 plan, 保留作为历史)
├── docs/superpowers/specs/
│   └── 2026-05-23-chain-watcher-v2-design.md   ★ 本文件
├── design/
│   ├── chain-watcher-ui-demos.pen   ★ Pencil 源
│   ├── demo[1-3]-*.png              ★ 3 风格 demo（决定 Linear/Vercel）
│   └── page-{watchlist,rules}.png   ★ 已 mock 的 v2 页面
├── config/
│   ├── rules.yaml                (seed only)
│   ├── rules-seed-builtin.yaml   ★ 内置 2 条规则 seed
│   ├── cex-hot-wallets.json      ★ M10
│   └── cex-blacklist.json        (legacy, M10 后迁入 labels 表)
├── src/
│   ├── labels/         ★ M10
│   ├── ingestors/
│   │   ├── evm.ts / btc.ts (existing)
│   │   ├── mempool.ts  ★ M15
│   │   ├── tron.ts     ★ M16
│   │   └── polygon.ts  ★ M16
│   ├── rules/
│   │   ├── engine.ts (refactored, M14)
│   │   ├── dsl.ts    ★ M14
│   │   ├── window-store.ts / backfill.ts / blacklist.ts (existing)
│   ├── notifiers/
│   │   ├── router.ts   ★ M12
│   │   ├── telegram.ts (hardened, M13)
│   │   ├── webhook.ts  ★ M13
│   │   ├── discord.ts  ★ M13
│   │   ├── slack.ts    ★ M13
│   │   └── sse-bus.ts (existing)
│   ├── api/
│   │   └── graph.ts    ★ M17
│   ├── utils/
│   │   ├── rpc-pool.ts ★ M9
│   │   └── (existing)
│   ├── storage/
│   │   ├── schema.sql (extended)
│   │   └── migrations/
│   │       ├── v1_001_initial.sql
│   │       ├── v2_001_rules.sql        ★ M14
│   │       ├── v2_002_labels.sql       ★ M10
│   │       ├── v2_003_subscriptions.sql ★ M12
│   │       ├── v2_004_mempool.sql      ★ M15
│   │       └── v2_005_alert_actions.sql ★ M12/M15
│   └── dashboard/public/
│       ├── index.html (overhauled, M11)
│       ├── css/
│       │   ├── tokens.css  ★ M11
│       │   ├── tokens-dark.css / tokens-light.css ★ M11
│       │   └── components.css ★ M11
│       └── js/
│           ├── router.js   ★ M11
│           ├── pages/{alerts,watchlist,stats,settings,rules,labels}.js ★ M11
│           └── components/{drawer,toast,chart,graph,filter-bar}.js ★ M11
└── test/
    └── 30+ test cases ★ M8-M17
```

---

## 13. 下一步

1. 用户审阅本 spec
2. 通过后调用 `writing-plans` skill 出 M8 的 implementation plan
3. M8 实施完成 / merge / 出 M9 plan，循环至 M17
