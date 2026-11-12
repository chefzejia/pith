# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：
> **单文件滑动任务栈与多 Worktree 协同契约**：详见 [ROLES.md](ROLES.md) 等文档。

---

## [Task #40] 架构重整：视图模块化拆解与双壳交互逻辑对称收敛

- **Status**: verified
- **Verified-Commit**: 77895ee44464140721fb3e4af6ecb7cf1cdfa180
- **Evidence**: `.tmp/evidence/task-40/final-report.md`；双端正常/窄屏操作截图位于同目录。
- **验收结果**: 双端材料导入/切换、播放定位/关闭、向导对话隔离/恢复、工具打开/移除通过；全仓 268 通过、70 条件跳过、0 失败。
- **Scope**: `src/workbench/view.ts` (拆解为 `src/workbench/view/*.ts`), `src/shells/`
- **验收摘要**：将核心视图组件（顶栏、目录、播放、向导、原位工具）模块化，样式归口统一；收敛 Web 与 Obsidian 壳在导入、路由、会话逻辑上的不一致，统一为 HostPort 适配器。
- **验证门禁**：`npm run typecheck && npm test` 全绿，确保双端体验完全对称。

---

## [Task #41] MVP 场景 1：纯阅读闭环（网页直投剪藏、结构化净化与行间翻译自动注入）

- **Status**: verified
- **Verified-Commit**: aa09b2fe04341fd6f3a2f58fd66e6adbff912765
- **Evidence**: `.tmp/evidence/task-41/live-after-user-exit-report.md`；同目录 `live-after-user-exit-native-paragraph-visible.png`、`live-after-user-exit-web-paragraph-visible.png` 及 original/restored 截图为本轮真实服务证据；早期固定译文仅属链路回归。
- **验收结果**: 独立 Tester 串行使用真实配置的 dsh，在隔离 Obsidian 与 Web 新材料中确认引文、实质正文的对应中文译文，原文/行间切换及缓存恢复通过；原生直接导入后明确改选费曼并重开保持。导入前显式选择的条件分支以工程回归覆盖，不虚构缺少入口的原生操作。Worker 类型检查、构建通过，全仓 274 通过、71 条件跳过、0 失败。
- **已修复边界**: URL 直接剪藏、结构净化、外文默认仅行间；正文块渐进翻译，单段纯文本响应避免生成式 JSON 引号解析失败。未修改 Agent/model/effort。
- **已知限制**: 双端采样通过不代表整篇稳定。Web 引文约 69 秒、正文约 145 秒出现，后续另一段发生一次 60000ms session/prompt 超时；未确认该失败提示的实际可见性与重试入口，未证明该段完成。自然语言向导剪藏另有超时，与 URL 直接导入分开记录。
- **产物核对**: 本轮同步并核对隔离 configDir 实际插件三文件哈希。此前原生失败进程缺少加载哈希，旧报告不能作为最新业务 SHA 原生失败的有效结论；不推断旧产物或用户退出是先前超时的确定原因。
- **Scope**: `src/plugins/guide-acp/externalIngest.ts`, `src/workbench/compass.ts`, `src/workbench/toolkitSlot.ts`, `src/plugins/dojo-interline/index.ts`, `tests/**`
- **验收摘要**：
  1. Omnibox 支持 URL 直投剪藏，跳过 Agent 生成直接落盘。
  2. 优化 HTML 净化 Markdown，完整保留标题、代码块与引用结构。
  3. EPUB/Blog 导入自动识别语言并自动挂载 `["interline"]`，开箱即双语模式就绪。
- **验证门禁**：通过英文博客导入即刻阅读且行间模式即时可用，断言工具组精确包含行间而不混入误报工具。

---

## [Task #42] 交付：把当前主干构建安装进真实 Vault，供人类真机首测

- **Status**: verified
- **Verified-Commit**: c1f6205ab492effb608fce6e68cf2547b183fbe6
- **Updated**: 2026-11-12
- **验收结果**: 类型检查通过；单测 288 通过、73 条件跳过、0 失败；浏览器 104 通过、4 可选语音检查跳过、0 失败。Tester 安装前后目录核对通过；干净 main `6236f5ecd5e6df15ec92f81039def72ca70d8644` 已执行 install:obsidian，真实 ganfan-media 中三个插件文件 SHA-256 与 dist 一致，无其余文件增删；未操作人类 Obsidian 或读取工作区正文。详见 delivery.txt。
- **Evidence**: `.tmp/evidence/task-42/worker-report.md`、`tester-readiness.md`、`plugin-before.json`、`tester-final.md`、`delivery.txt`。
- **Scope**: 无源码改动；只运行门禁、构建与安装命令
- **背景**：人类在真实 Obsidian 做真机测试，构建与安装归执行环（[ROLES.md](ROLES.md) 第 6 条）。主干 `6017590` 含 10 个未经独立复核的提交（`eac6561..6017590`）。
- **契约**：
  1. 在干净的主工作树 `main` 上执行，记录交付的提交 SHA。
  2. `npm run typecheck`、`npm test`、`npm run test:browser` 均无失败；任一失败则不安装。
  3. 按 ROLES 第 6 条执行交付步骤。
  4. 睡前审计若对 `eac6561..6017590` 清创并产生代码提交，清创复验通过后对新提交重新执行交付步骤。
- **不在范围内**：修改源码；启动、退出或重载人类的 Obsidian；读取 Vault 内 Pith 工作区的正文。
- **证据**：`.tmp/evidence/task-42/delivery.txt`。安装前真实 Vault 的三个插件文件备份在 `.tmp/evidence/self-use-wave1/real-vault-plugin-backup/`。

---

## [Task #43] 修复 `npm run verify:obsidian`：隔离真机脚本与当前设置页行为一致

- **Status**: verified
- **Verified-Commit**: c59dcb513e060abbc1a4bfaa6fdc87922ef2261f
- **Updated**: 2026-11-12
- **验收结果**: 原失败复现；类型检查通过，单测 289 通过、73 条件跳过、0 失败；Worker 连续两次及 Tester 独立一次 verify:obsidian 均退出 0，报告与落盘模式/配置一致，两条自有健康检查命中且零密钥读取；抑制模式保存的破壁验证按预期失败。加载哈希、截图与进程/端口清理均核对；仅修改两个授权文件。
- **Evidence**: `.tmp/evidence/task-43/worker-report.md`、`tester-report.md`、`tester-terminal.log`、同目录 PNG 截图。
- **Scope**: `scripts/verify-obsidian-e2e.ts`, `tests/obsidian-e2e-safety.test.ts`
- **背景**：在构建 `145e047`（与 `6017590` 只差文档）上运行 `npm run verify:obsidian`：真实 Obsidian 加载插件、挂载 `pith-reader` 视图并渲染设置页，随后在语音设置一步以 `Auto-save timed out` 失败，日志在 `.tmp/evidence/self-use-wave1/verify-obsidian-145e047.log`；失败后隔离工作区落盘的设置里 `speech` 为空对象。读代码得到的原因（未经运行证实，Worker 先复现确认）：脚本把语音模式设为本机后等待端点字段落盘，而设置页自 `f470ec8` 起只在云端模式保存这些字段（`src/shells/obsidian/index.ts` 的 `if (mode.value !== "cloud") return;`）；脚本自 `183c625`（11-06）后未再更新。
- **契约**：
  1. 产品行为不变；脚本按当前行为验收：插件加载、`pith-reader` 视图挂载、设置页挂载、语音模式切换落盘、本机语音健康检查命中脚本自有的桩且不读取密钥存储。
  2. 只操作脚本自己拉起的隔离实例；与人类正在运行的 Obsidian 并存。
- **不在范围内**：`src/` 下任何改动。复现中发现的产品缺陷在验收报告里单列，不在本任务修。
- **Worker 门禁**：`npm run typecheck`、`npm test`；`npm run verify:obsidian` 连续两次退出码为 0；手动破壁（让设置页不保存模式切换）后脚本失败。
- **Tester 终验**：独立运行 `npm run verify:obsidian` 一次，核对输出报告与隔离 Vault 内落盘的设置一致。

---

## [Task #44] 看板列出读不出来的课题与材料

- **Status**: pending
- **Verified-Commit**: none
- **Updated**: 2026-11-12
- **Scope**: `src/core/types.ts`, `src/core/store/**`, `src/core/engine/**`, `src/workbench/compass.ts`, `src/workbench/view/styles.ts`, `src/shells/web/**`, `src/shells/obsidian/index.ts`, `docs/subsystems/1-core-store-engine.md`, `docs/subsystems/5-spatial-ui-and-slots.md`, `tests/**`
- **背景**：`DefaultWorkspaceStore.listTopics` 与 `listMaterials` 静默跳过解析失败的条目。在 Obsidian 里手改 `topic.md`（例如删掉笔记块里的一个空行）后，课题从看板消失且没有任何提示；沙盒复现的解析错误是 `Invalid note metadata`。
- **冻结的内核契约**（Worker 原样落地，不另行扩展）：
  ```ts
  // src/core/types.ts
  export interface UnreadableEntry { readonly kind: "topic" | "material"; readonly id: string; readonly path: string; readonly error: string }
  // src/core/store/contract.ts · WorkspaceStore
  /** Topic and material folders whose ledger file fails to parse; `listTopics` and `listMaterials` omit them. */
  listUnreadable(): Promise<readonly UnreadableEntry[]>;
  // src/core/engine/contract.ts · AttentionCompassSnapshot
  readonly unreadable: readonly UnreadableEntry[];
  ```
  `id` 是目录名，`path` 是账本文件相对工作区的路径，`error` 是解析器给出的原因。账本 `id` 与目录名不一致的条目同样列出。
- **行为契约**：看板在「探索中」「已沉淀」之外显示「无法读取（N）」分区，每条给出文件路径与原因；只读，不自动修复、不删除、不改写文件；N 为 0 时分区不出现；文件修好后重新打开看板，条目回到原分区。两个宿主壳一致。
- **不在范围内**：放宽解析器；自动修复；笔记格式迁移。
- **Worker 门禁**：`npm run typecheck`、`npm test`、`npm run test:browser`；回归从磁盘字节构造损坏文件；手动破壁（`listUnreadable` 恒返回空）后回归变红；界面自拍存 `.tmp/evidence/task-44/`。
- **Tester 终验**：在沙盒工作区分别手改一个 `topic.md`（删掉笔记块里的空行）与一个 `material.md`，两个宿主壳的看板都出现对应条目与原因；恢复文件后条目回到原分区；截图归档。
- **交付**：验收通过后执行 ROLES 第 6 条。

---

## [Task #45] 调研：dsh 对话体验对齐清单（只读，不改产品代码）

- **Status**: pending
- **Verified-Commit**: none
- **Updated**: 2026-11-12
- **Scope**: 只写 `.tmp/evidence/task-45/`；不改两个仓库中任何被跟踪的文件，与其他任务的写集正交
- **背景**：人类决定 Pith 向导栏的对话体验以 dsh 为基准（`/Users/zejiawu/Projects/Project-Atlas/infra/deepseek-harness`，提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`，MIT 许可）。Brain 据本任务的清单冻结实现契约，再派实现任务。
- **硬约束**（清单中每条提案都须满足）：Pith 工作台是全 Shell 共享的零依赖 DOM（`src/workbench/`）；向导只走标准 ACP（[AGENTS.md](../AGENTS.md) 核心约束 2）；dsh 的界面代码不引入 Pith，只对齐行为与观感。
- **Brain 读代码得到的待核实事实**（逐条用源码与一次真实运行证实或推翻）：
  1. dsh 的 ACP 服务只下发已提交的消息、思考、工具生命周期、配置变更与上下文用量，不下发逐字增量（`packages/acp/acp/README.md`、`packages/acp/acp/src/updates.ts`）。
  2. 每个 ACP 会话同一时刻只有一个进行中的 prompt；支持 `session/resume`、`session/cancel` 与挂载 MCP 服务。
  3. dsh 自己的 ACP 客户端对单次 prompt 不设期限，可配置的时长只有进程收尾宽限（`packages/subagent/subagent-acp/src/index.ts`）。
  4. 停止控件在 `packages/client/ui-conversation/src/client/skeleton/InputBar.tsx`；对话节点、过程折叠与失败行的规则在 `packages/client/ui-chat/README.md` 与 `docs/subsystems/conversation.md`。
- **交付物**：`.tmp/evidence/task-45/dsh-conversation-alignment.md`，一张逐项对照表加参考材料：
  - 覆盖面：一轮对话的组成（用户消息、助手回复、思考预览、工具与过程行、失败行、向用户提问）及完成后的折叠规则；运行中的输入区（停止、运行中再发送消息的去向、按键、禁用态）；等待、失败、停止与重试（失败回合的用户消息是否保留）；助手回复的 Markdown 渲染范围与跟随滚动；间距、字号、配色、圆角等观感取值（明暗两套）。
  - 每一项给出：dsh 的做法与 `文件:行` 出处；标准 ACP 能否支撑及依据；Pith 现状与 `文件:行`；差距；在硬约束内的做法与工作量估计；不建议对齐时写明理由。
  - 一份真实 `dsh --profile acp` 多步回合的 `session/update` 记录（各类更新及其到达时间），用来证实「标准 ACP 能否支撑」一栏。
  - dsh Web 界面的参考截图：运行中、已完成、失败、被停止的回合各一组，明暗两套。
- **运行约束**：真实 dsh 在 `.tmp/task-45/` 下的独立工作目录运行；不读取、不输出凭据；dsh 自身留下的会话与日志在报告中列出位置。
- **不在范围内**：修改 Pith 或 dsh 的被跟踪文件；实现任何对齐项。
- **Worker 门禁**：清单中每条 dsh 引用都能在上述提交按 `文件:行` 打开并支持其论断；截图扩展名与真实编码一致。
- **Tester 终验**：独立抽查不少于 10 条引用；核对 `session/update` 记录与「标准 ACP 能否支撑」一栏一致；核对截图与文字描述一致。

---
