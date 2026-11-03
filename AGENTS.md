# Pith

> **Agents automate your output. Pith grows your core.**
> **当所有 AI 都在替你加速输出，Pith 留你慢下来长出内核。**

Pith 是一个宿主无关的**个人注意力与深度内化系统（Personal Attention & Mastery System）**。本仓库（`/Users/zejiawu/Projects/Project-Atlas/labs/pith`）独立维护，采用**「极简强主干（`src/core`）+ Agent 动态调度的内置插件（`src/plugins`）+ 多态原生宿主壳（`src/shells`）」**三层同心圆架构。

---

## 一、 按需与按序阅读（Documentation & Handoff）

- **接手当前状态、路线图与协作进展**：[HANDOFF](docs/HANDOFF.md)
- **多 Agent 协作角色分工（Brain / Worker / Tester）**：[ROLES](docs/ROLES.md)
- **编号设计契约（按序阅读，严禁前向依赖）**：
  1. [000 Philosophy](docs/000-philosophy.md)：注意力守恒定律、慢输入与具身内化哲学
  2. [001 Domain Model](docs/001-domain.md)：四大持久领域概念（`Profile` · `Topic` · `Material` · `Note`）与去隐喻化词表
  3. [002 Architecture](docs/002-architecture.md)：`Core`（`PluginRuntime` / `WorkspaceStore` / `AttentionEngine`）、6 大内置插件分类（`stage-*` / `dojo-*` / `guide-*` / `*-service`）与 `HostPort` 多壳设计
  4. [003 Interaction & Spatial Design](docs/003-interaction.md)：44px 极简顶栏（单一弹性工具胶囊槽 `[✦ 工具 · N ▾]`）、实心停靠播客甲板（`.pith-media-deck`）、跨设备连续几何自适应算法（`resolveResponsiveLayout`）与霞鹜文楷书卷视觉体系

---

## 二、 只读外部参考遗产（Reference Repositories · 按需查阅，互不运行时耦合）

当需要继续深挖特定子领域细节时，直接只读参考本机以下母本仓库（Pith 运行时对它们**零依赖**）：

| 参考对象 | 本机路径 / 来源 | 核心借鉴与资产承接点 |
| :--- | :--- | :--- |
| **`ganfan-garden` (`Sylva`)** | `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden` | Pith 的前身母本：1,451 行 `styles.css` 书卷视觉体系、霞鹜文楷 `LXGW WenKai` 字库、`src/material/`（12,203 行 EPUB/PDF/CBZ/Timeline 渲染深度细节）、`docs/PRODUCT.md` 四阶渐进脚手架哲学 |
| **`obsidian_labs`** | `/Users/zejiawu/Projects/Project-Atlas/labs/obsidian_labs/packages/obsidian-agent-runtime` | 本机 Agent CLI 自动扫描发现（`dsh --profile acp` / `claude-agent-acp` / `codex-acp`）与 JSON-RPC over stdio ACP 会话生命周期隔离 |
| **`ganfan-audio`** | `/Users/zejiawu/Projects/Project-Atlas/ganfan-audio` | 本机高保真单次语音克隆正式入口 `bin/tts-clone`（基于 `IndexTTS-2.5`，供 PC 端离线合成播客音频资产；**严禁使用其中废弃占内存的 `bench/Qwen3-TTS`**） |
| **`magpie`** | `/Users/zejiawu/Projects/Project-Atlas/infra/magpie` | `internal/pluginrt` 同步注册、服务栈（Service Stacking）、`InUse` 传递保活与 `kernel.js` 视图槽位错误隔离思想（注：Pith 插件由内核与 Agent 按需编排，**不向用户暴露插件开关面板**） |
| **`deepseek-harness` (`DSH`)** | `/Users/zejiawu/Projects/Project-Atlas/infra/deepseek-harness` | Cordis Capability Seam（`Definition + Provider + Consumer`）能力接缝解耦与可逆清理（`onDispose`） |
| **`Readest` 交互范式** | `ganfan-garden/src/material/render/pagination.ts` & `reflowable.ts` | 按屏双页并排翻页几何计算、滚轮防抖与上下左右方向键统一翻页、跨窗口缩放内在位置（`IntrinsicLocator`）无损恢复 |

---

## 三、 五条硬边界（Hard Invariants · 由 `tests/boundaries.test.ts` 与全套门禁强制守卫）

1. **单向依赖与插件隔离（`PluginsImportOnlyCore`）**：
   - `src/core/` 绝不导入 `src/plugins/` 或 `src/shells/`；
   - `src/plugins/<id>/` 之间绝不互相导入（仅通过 `ctx.provide` / `ctx.service` 通信）；只有 `src/plugins/all.ts` 汇总导入所有内置插件。
2. **宿主零泄漏（`Host-Agnostic Core & Plugins`）**：
   - `src/core/**` 与 `src/plugins/**` 严禁导入 `node:*`、`"obsidian"` 或 `@deepseek-ai/*`；所有文件、网络、密钥、子进程能力均经由 `HostPort`（`src/core/host.ts`）注入。
3. **内核去隐喻化与「插件由 Agent 编排」原则**：
   - 内核仅使用中性领域词（`Workspace`, `Profile`, `Topic`, `Material`, `Note`, `Anchor`, `Guide`）；
   - 插件化服务于工程解耦与 Agent 动态挂载实训工具（`topic.toolkits`），**严禁在 UI 设置中向用户暴露底层插件手动勾选开关列表**。
4. **高品质语音零妥协（`Zero OS-TTS Garbage · Fail-Closed`）**：
   - 全仓永久封杀浏览器/系统自带低劣语音（`window.speechSynthesis`、`SpeechSynthesisUtterance`、`webkitSpeechRecognition`、`say`、`SiriTTS`）及废弃慢速的 `Qwen3-TTS`！未连接高品质语音（如 `kokoro-local`、`IndexTTS-2.5` 衍生音频或云端 `openai-tts`/`azure-neural`）时必须干脆利落地 Fail-Closed 提示。
5. **测试环境卫生与真实 Vault 保护铁律（`Single Dev Vault`）**：
   - **严禁触碰用户的真实 Obsidian Vault**（特别是 `/Users/zejiawu/Library/Mobile Documents/iCloud~md~obsidian/Documents/ganfan-media` 与 `/Users/zejiawu/Downloads`）！
   - 所有 Obsidian 真机调试与 CUA 验收**唯一固定复用** `/Users/zejiawu/Projects/Project-Atlas/labs/pith/.dev-vault`（数据收纳于顶层 `Pith/` 命名空间下），严禁在 `/tmp` 或别处新建随机垃圾空 Vault。

---

## 四、 常用验证与运行命令

```bash
npm run typecheck          # TypeScript 全仓零报错检查
npm test                   # 运行全部单测与架构边界门禁（当前 126 项全绿）
npm run build:obsidian     # 一键打包生成 dist/obsidian/{main.js,manifest.json,styles.css}
npm run web                # 启动独立 Web 桌面壳 (默认 http://127.0.0.1:4173)
```
