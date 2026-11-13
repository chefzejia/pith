# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：
> **单文件滑动任务栈与多 Worktree 协同契约**：详见 [ROLES.md](ROLES.md) 等文档。
>
> **状态**：`pending`（执行环按序执行）· `queued`（前置任务未完成，执行环不执行）· `verified` · `blocked` · `superseded`。Router 核销一个任务时，在同一次提交里把 `Depends-On` 已全部满足的 `queued` 任务改为 `pending`（[ROLES.md](ROLES.md) 第 2 条）；前置任务 `blocked` 时链条停住，等 Brain。
>
> **本轮重构规则**，各任务不再重复：
> 1. 目标契约在 `docs/`，源码与契约的差距列在 [ARCHITECTURE.md](ARCHITECTURE.md) 第六节。任务完成时删掉该表里属于自己的行；一行列了多个任务的，由其中最后完成的那个删。最后一行删掉后连同整节删除。
> 2. 不做兼容（[AGENTS.md](../AGENTS.md) 核心约束 3）：旧格式不读取、不迁移、不留别名。被新契约取代的测试直接改写或删除，并在 Worker 报告里逐个列出文件名与原因；不得为了让旧测试通过而保留旧行为。
> 3. 冻结的内核形状在 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 4 节。发现契约自相矛盾或无法落地时标 `blocked` 并写明证据，不自行改契约。
> 4. 每个任务的 Worker 门禁都包含 `npm run typecheck`、`npm test`；改到 `src/workbench/`、`src/shells/` 或舞台渲染的还包含 `npm run test:browser` 与 `npm run build:obsidian`。下面各任务只列额外的门禁。
> 5. 清理按 [ROLES.md](ROLES.md) 第 7 条。

---

## [Task #51] 内核：材料与课题分离
- **Status**: verified
- **Depends-On**: None
- **Verified-Commit**: 1f371310c869bfe619b8905cf8423474c88e80cd
- **Updated**: 2026-11-13
- **验收结果**: Worker 全仓门禁与四项手动破壁通过；Web 与隔离 Obsidian 的真实 Agent 完成多材料立项、讲义、笔记回跳、材料复用与用户证据结题，补验覆盖快捷动作及已测路径/状态边界。补验的 Web 工具负例由受控客户端调用真实产品模块，未冒充模型回合。本轮双方资源已清理；旧浏览器退出回执缺失，经 Router 精确查询专属 profile 无活动进程及目录占用后清理剩余沙盒。报告及截图：`.tmp/evidence/task-51/tester-1f37131/`、`.tmp/evidence/task-51/tester-boundaries/`；Worker 报告：`.tmp/evidence/task-51/resume-worker/report.md`；清理复核：`.tmp/evidence/task-51/router-cleanup.md`。未交付真实 Vault。
- **Scope**: `src/core/**`、`src/plugins/**`、`src/shells/**`、`src/workbench/**`、`tests/**`、`docs/ARCHITECTURE.md`
- **契约**: 
  1. 类型、磁盘格式与存储接口按 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 2、3、4 节落地。
  2. 旧格式不读取。
  3. 引擎补齐 `intake`、`capture` 与看板快照。
  4. 向导工具按 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.5 终态。
  5. 场景提示词按 2.2 落地。
  6. 记录的作者字段（不变量 7）实现。
- **交付**: 不交付。

---

## [Task #55] PDF 核心渲染与锚点支持
- **Status**: pending
- **Depends-On**: #51
- **Updated**: 2026-11-13
- **Scope**: `src/plugins/stage-reader/**`, `tests/**`
- **契约**: 移植 `ganfan-garden` 中的 PDF 渲染实现，作为 `stage-reader` 独立插件。PDF 元素需正确映射 `data-locator`，支持跨文档锚点跳转及高亮。
- **交付**: 不交付。

---

## [Task #56] ACP 通信稳健性与错误处理
- **Status**: verified
- **Depends-On**: #51
- **Verified-Commit**: d8f5d4e30bf22fa1cdd3e8776729719d551284d5
- **Updated**: 2026-11-14
- **验收结果**: Worker 全仓类型、单测、浏览器回归、构建与 13 次手动破壁通过；组合版本在独立 Chrome 和专属 `.dev-vault` Obsidian 中通过真实 Agent 多工具读写、停止及同回合重试，用户消息未重复。原版受控进程故障另行覆盖异常重开、部分回复及写入后失败不自动重放，不冒充真实模型故障；真实停止未覆盖工具写入进行中。构建加载哈希一致；本轮 17 次 Agent 启动均有退出回执，43 个登记 PID 不存在，端口和运行沙盒已回收，Cleanup: PASS。报告及终验截图：`.tmp/evidence/task-56/tester/combined/tester-report.md`、`.tmp/evidence/task-56/tester/combined/`；原版故障证据：`.tmp/evidence/task-56/tester/tester-report.md`；组合工程证据：`.tmp/evidence/task-56/integration-report.md`。未交付真实 Vault。
- **Scope**: `src/plugins/guide-acp/**`, `src/shells/**`
- **契约**: 强化 ACP 通信协议，增加对工具调用超时、状态丢包、异常中断后的状态恢复逻辑。
- **交付**: 不交付。

---

## [Task #52] 工作台：材料库、材料阅读、立项与工具归属
- **Status**: queued
- **Depends-On**: #55, #56
- **Updated**: 2026-11-13
- **Scope**: `src/workbench/**`、`src/shells/**`、`src/plugins/toolkit-*/**`、`src/core/seams.ts`、`tests/**`、`docs/ARCHITECTURE.md`
- **契约**: 首页立项分流与材料库、材料阅读场景（高亮/笔记）、课题内目录/抽屉、工具归属（按角色/role）与行间驱动。
- **交付**: 不交付。整体在 #54 终验后交付。

---

## [Task #53] 费曼复述：要点对照
- **Status**: queued
- **Depends-On**: #52
- **Updated**: 2026-11-13
- **Scope**: `src/plugins/toolkit-feynman/**`、`src/core/seams.ts`（`followUp`）、`src/workbench/**`、`src/shells/**`、`tests/**`、`docs/ARCHITECTURE.md`
- **契约**: 费曼新规程（对照原文、要点/复述的自动化核对、追问机制、evalMode 修正）。
- **交付**: 不交付。整体在 #54 终验后交付。

---

## [Task #54] 终验：整体验收与交付
- **Status**: queued
- **Depends-On**: #53
- **Updated**: 2026-11-13
- **Scope**: 验收工作区 `.tmp/evidence/task-54/`。包含：契约对照、全量门禁、真实用户路径（投喂/立项/课题内/训练/结题/搁置/无Agent/沙盒/旧格式）、观感终审包。
- **报告**: `.tmp/evidence/task-54/final-report.md`。
- **交付**: 以上全部通过后执行 [ROLES.md](ROLES.md) 第 6 条。
