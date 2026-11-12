# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：
> **单文件滑动任务栈与多 Worktree 协同契约**：详见 [ROLES.md](ROLES.md) 等文档。
>
> **状态**：`pending`（执行环按序执行）· `queued`（前置任务未完成，执行环不执行）· `verified` · `blocked` · `superseded`。`queued` 的任务由 Brain 在前置任务 `verified` 后改为 `pending`；执行环不自行改。
>
> **本轮重构（#46 至 #53）的共同规则**，各任务不再重复：
> 1. 目标契约在 `docs/`，源码与契约的差距列在 [ARCHITECTURE.md](ARCHITECTURE.md) 第六节。任务完成时删掉该表里属于自己的行；一行列了多个任务的，由其中最后完成的那个删。最后一行删掉后连同整节删除。
> 2. 不做兼容（[AGENTS.md](../AGENTS.md) 核心约束 3）：旧格式不读取、不迁移、不留别名。被新契约取代的测试直接改写或删除，并在 Worker 报告里逐个列出文件名与原因；不得为了让旧测试通过而保留旧行为。
> 3. 冻结的内核形状在 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 4 节。发现契约自相矛盾或无法落地时标 `blocked` 并写明证据，不自行改契约。
> 4. 每个任务的 Worker 门禁都包含 `npm run typecheck`、`npm test`；改到 `src/workbench/`、`src/shells/` 或舞台渲染的还包含 `npm run test:browser` 与 `npm run build:obsidian`。下面各任务只列额外的门禁。
> 5. 清理按 [ROLES.md](ROLES.md) 第 7 条。

---

## [Task #44] 看板列出读不出来的课题与材料

- **Status**: verified
- **Verified-Commit**: 3c6b3bb5a406daa69573227fe359c162f7ea8b73
- **Updated**: 2026-11-12
- **验收结果**: 全仓类型/构建通过；单测 291 通过、74 条件跳过，浏览器 107 通过、4 可选跳过，0 失败；恒空 listUnreadable 破壁回归准确失败。独立 Tester 在真实隔离 Obsidian 与 Web 验证损坏 topic/material、双类 ID 不一致、只读、完整恢复、零条隐藏、正常/窄栏路径换行均通过。原生总窗口 390px 且右侧栏占满时中央仅 22px 不作可用宽度保证，收起自有侧栏后 267px 验收通过。
- **Evidence**: `.tmp/evidence/task-44/worker-report.md`、`tester-report.md`、`tester-*-errors-*.png`、`tester-*-restored-*.png`；已从干净 main `b5af6df` 交付 Worktree 安装到真实 ganfan-media，Tester 独立核对三文件 SHA-256 与主目录 dist 一致，其余目录条目未变；交付 Worktree 已删除，外部未提交讨论文档保持不变。详见 `delivery.txt`、`tester-delivery.md`。
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

- **Status**: verified
- **Verified-Commit**: 3c2f120ba130d4d9ac25b5d536059278a69574ab（Pith 研究基线；dsh 基线 fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159；本单无代码提交）
- **Updated**: 2026-11-12
- **验收结果**: 32 项对照清单、真实 ACP 多步回合记录、四状态明暗八张 Web 截图齐备；独立 Tester 抽查 24 项语义引用，核对冻结源码、协议事件与全部截图通过。旧文案 D45-01 已纠正并复验。二进制构建 SHA 未证实、thought/permission/HTTP MCP 等未实测边界均明列；不把 Web Stop 当 ACP 活动回合取消证明。两个仓库的跟踪文件均未为本调研改动。
- **Evidence**: `.tmp/evidence/task-45/dsh-conversation-alignment.md`、`tester-final.md`、`acp-mcp-trace.jsonl`、`screenshots/`；报告 SHA-256 `a668e3882597732d505bea37ebd74b1ac81431dcbd3f9e5f78361567112462a7`。
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

## [Task #46] 改名：`dojo` 统一为 `toolkit`

- **Status**: verified
- **Verified-Commit**: 6c7ea68145a3844b83990fc8e556e4700e125b40
- **Updated**: 2026-11-12
- **验收结果**: 类型检查、全仓单测与浏览器测试、Obsidian 构建通过；命名守卫与未知工具 ID 校验均经手动破壁。独立 Tester 在 Web 与隔离 Obsidian 操作行间、字幕跟读、费曼复述和工具开关，并检查实际加载产物哈希及无效 ID。译文、向导回复、音频和转写使用受控夹具，不代表真实模型或语音服务验收。
- **Evidence**: `.tmp/evidence/task-46/worker-report.md`、`.tmp/evidence/task-46/tester/tester-report.md` 与同目录截图；运行沙盒与自有进程已清理。首次中止的浏览器测试曾写入 `.tmp/evidence/task-39/web-interline.png`，无法确认是否覆盖原有截图。
- **Scope**: `src/**`、`tests/**`、`scripts/**`（只为改名）、`docs/ARCHITECTURE.md`（删差距行）、`docs/subsystems/3-toolkits.md`（更新验证命令）、`docs/subsystems/5-spatial-ui-and-slots.md`（只为同步类名）
- **背景**：这个概念在契约里只叫 `Toolkit`（[3-toolkits.md](subsystems/3-toolkits.md) 第 1 节）。源码 22 个文件、测试 39 个文件含 `dojo`。先做完改名，后面的重构不用在两套名字之间来回。
- **契约**：行为不变，只改名字。
  1. 目录 `src/plugins/dojo-<id>/` 改为 `src/plugins/toolkit-<id>/`（用 `git mv`）；插件 ID `dojo-<id>` 改为 `toolkit-<id>`；服务名 `dojo.<id>` 改为 `toolkit.<id>`。
  2. 类型：`DojoToolkitDescriptor` 改为 `ToolkitDescriptor`（删掉现有的同名别名），`DojoScaffoldStage` 改为 `ToolkitStage`，`DojoDiagnosisResult` 改为 `ToolkitDiagnosis`。
  3. 其余标识符、函数名、字段名、CSS 类名、`data-*` 属性、元素 ID 里的 `dojo` / `Dojo` 一律换成 `toolkit` / `Toolkit`（例：`.pith-dojo-panel` 改为 `.pith-toolkit-panel`，`#open-dojo` 改为 `#open-toolkit`，`data-dojo-submit` 改为 `data-toolkit-submit`）。
  4. 面向用户的文案与插件名里不出现 `Dojo` 或「道场」。
  5. 测试文件名里的 `dojo` 改为 `toolkit`（`tests/dojo-interline.test.ts`、`tests/task18-dojo-browser.test.ts`、`tests/wave5-trackA-dojo-feynman.test.ts`）。
  6. 账本里的工具 ID 只有不带前缀的一种写法。删除对 `dojo-<id>` 与 `none` 的识别和过滤（`src/workbench/toolkitSlot.ts` 及各调用点）；`pith_configure_toolkits` 与用户开关只接受已注册的工具 ID，未知 ID 报错。「不挂任何工具」就是空列表。
  7. 在 `tests/boundaries.test.ts` 加一条守卫：`src/`、`tests/`、`scripts/` 的文件内容与文件名里不出现 `dojo`（不区分大小写）。
- **不在范围内**：任何行为变化；工具角色（`aid` / `training`）拆分；`docs/TASKS.md` 与 `docs/LESSONS.md` 里的历史记录。
- **Worker 门禁**：`npm run test:browser`、`npm run build:obsidian`；`git grep -il dojo -- src tests scripts` 无输出；手动破壁（把一处标识符改回 `dojo`）后新守卫变红。
- **Tester 终验**：两个宿主壳各走一遍：打开带行间的外文材料、对一句字幕做影子跟读、对一段正文做费曼复述、在顶栏开关工具。行为与改名前一致，截图归档。
- **交付**：不交付。真实 Vault 等 #52 之后整体换代。

---

## [Task #47] 画像只增删观察条目，写前留底

- **Status**: pending
- **Verified-Commit**: none
- **Updated**: 2026-11-12
- **Brain 裁决（2026-11-12，契约提交 `7446d5f`）**：阻塞成立，错在契约。「用户明确说记住时才写」是对自然语言的判断，程序核对不了；用关键词猜、加确认弹窗都不采用。裁决是去掉课题进行中的写入：向导只在结题时写画像（[1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 2 节不变量 8，[4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.5）。下面契约第 5、6 条与验收已按此改写；第 1 至 4 条已在候选 `8796b01` 上通过，保留。
- **上一轮的阻塞记录**：真实 Agent 在用户要求「达标后结题并记录观察」、向导仍在追问的回合里单独调用 `pith_remember` 写入画像；候选 `8796b01ebd2b0da8085ac70994f1a8d3e0f16fab` 只靠提示词约束，执行路径没有可核对的授权检查，三轮修复后独立 Tester 未通过。
- **已完成及证据**: 真实记忆和结题已各成功一次，画像标记外字节与写前备份符合验收；单测、浏览器测试、构建与破壁检查通过。历史失败、最新复验和清理见 `.tmp/evidence/task-47/tester/retest-2f78ecc/tester-report.md`、`.tmp/evidence/task-47/tester/retest-8796b01/tester-report.md` 与 `.tmp/evidence/task-47/background/worker-report.md`。本项未安装到真实 Vault。
- **Scope**: `src/core/types.ts`、`src/core/host.ts`、`src/core/store/**`、`src/plugins/guide-acp/**`、`src/shells/**`（存储端口的 `copy` 与 dsh 壳的工具）、`src/workbench/**`（只为编译通过）、`tests/**`、`docs/ARCHITECTURE.md`（删差距行）
- **背景**：`pith_settle_topic` 现在整篇替换 `ME.md`（`src/plugins/guide-acp/tools.ts` 的 `store.writeProfile(profile)`），dsh 壳另有一个整篇替换的 `pith_update_profile`。已安装的版本每次结题都可能改写用户自己写的内容。本任务排在 #46 之后，写集与它重叠。
- **契约**：
  1. 磁盘格式按 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 3.4；类型与存储接口按同文档第 4 节的 `ProfileObservation`、`LearnerProfile`、`addObservation`、`removeObservation`。`writeProfile` 从接口、实现和所有调用点删除。
  2. `WorkspaceStoragePort` 增加 `copy(from: string, to: string): Promise<void>`，两个宿主壳与测试用的内存实现各自实现。
  3. 每次写入前把当前 `ME.md` 复制到 `history/ME-<timestamp>.md`；复制失败则不写入。
  4. 两个标记之外的字节在任何写入前后完全相同。标记不存在时在文件末尾追加这一节；标记残缺或重复时拒绝写入，错误信息说明是哪一种。
  5. 工具（[4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.5）：画像只有 `pith_settle_topic` 一个写入口，参数 `observations?: { text, noteId? }[]` 与 `removeObservationIds?: string[]`，给了 `noteId` 时它必须是本课题已有的记录（已落地，保留）。**删除 `pith_remember`**：工具定义、提示词里的「记忆请求」一节、工具清单里的名字、dsh 壳工具列表里的这一项。dsh 壳的 `pith_update_profile` 已删除，保持。
  6. 场景提示词：用户要求记住某件事时，用 `pith_save_note` 把它记成本课题的一条笔记，并说明画像在结题时才更新，不声称已写入画像。结题门禁一节保留新参数的说明。
  7. 本任务不改工具的传输方式：工具仍经现有的文本围栏调用，`topicId` 参数保留。传输在 #49 更换。
  8. 守卫单测：`src/` 里调用 `addObservation` 的只有 `pith_settle_topic` 的实现；调用 `removeObservation` 的只有 `pith_settle_topic` 的实现（工作台的撤销在 #50 加入时再放宽这条守卫）。
  9. 上一轮为挡住畸形工具文本加的校验（围栏不在末尾、行内围栏、裸标记、裸 JSON）与后台下一步行动的隔离保留不动，它们在 #49 随文本围栏一起删除。
- **不在范围内**：对话里的画像行与撤销（#50）；MCP（#49）；记录的作者字段与「结题门禁只认用户写的记录」（#51，见 [ARCHITECTURE.md](ARCHITECTURE.md) 第六节。本任务交付后门禁仍然只数条数，这是已知的、列在差距表里的缺口）。
- **Worker 门禁**：回归从磁盘字节构造三种 `ME.md`（没有观察一节、已有若干条、标记残缺），断言标记之外逐字节不变、留底文件内容等于写入前的全文；手动破壁（让写入改动标记之外的一个字节）后回归变红；手动破壁（跳过留底）后回归变红。本轮新增：用可控的假 Agent 输出一个 `pith_remember` 调用，断言它被当作未知工具拒绝、`ME.md` 与 `history/` 逐字节不变；手动破壁（把 `pith_remember` 加回工具表）后这条回归与第 8 条守卫变红。
- **Tester 终验**：在沙盒工作区用真实配置的 Agent：先对向导说「记住我熟悉依赖注入」，`ME.md` 与 `history/` 逐字节不变；再重复上一轮出过问题的那句话（回答问题后说「若达标请结题并记录观察」），在向导继续追问的回合里 `ME.md` 不变；最后完成结题：`ME.md` 里手写的段落不变，新增条目带日期、课题与证据笔记，`history/` 里有上一版。验收的依据是这三处的文件字节，以及工具表与第 8 条守卫。向导有没有把那句话记成笔记、有没有误称已写入画像，是模型行为：如实写进报告，不作为通过条件；误称出现时由 Router 记入 `LESSONS.md`。
- **交付**：验收通过后执行 [ROLES.md](ROLES.md) 第 6 条。这一项修的是已安装版本里的数据问题，不等 #52。

---

## [Task #48] 实测：工具端点的两个前提

- **Status**: verified
- **Verified-Commit**: edf20bfd064d40767129ff4b0c4a439580626486（研究启动时的 Pith 基线；本任务无业务代码提交）
- **Updated**: 2026-11-12
- **验收结果**: 真实 dsh 通过 HTTP MCP 执行读写；只读模式下 MCP 写入直接放行，内置写入则先被拒绝并可请求授权。活动工具取消、其他适配器初始化的结果和未覆盖边界均有记录。独立 Tester 重跑 HTTP 及只读模式，与报告一致；没有将适配器能力声明或受控端点视为生产端到端验证。
- **Evidence**: `.tmp/evidence/task-48/tool-endpoint-premises.md`、`.tmp/evidence/task-48/tester/tester-report.md` 及同目录协议记录；自有进程、端口与运行沙盒已清理。#49 的契约仍须 Brain 复核。
- **Scope**: 只写 `.tmp/evidence/task-48/` 与 `.tmp/runtime/task-48/`；不改任何被跟踪的文件，与其他任务的写集正交
- **背景**：#49 的设计建立在两个只读过源码、没有运行过的前提上（[ARCHITECTURE.md](ARCHITECTURE.md) 第六节末尾）。#45 实测过 stdio 方式的 MCP 服务，没有测过 HTTP 方式，也没有出现过权限请求。
- **要回答的问题**（每个都用真实已安装的 `dsh --profile acp` 运行来回答，留存完整的 ACP 收发记录与工具端点收到的请求）：
  1. **HTTP 方式的 MCP 服务是否可用。** 起一个只监听回环地址的最小 MCP 服务：每个请求一条 JSON-RPC 消息、以 JSON 回应、不开事件流；要求一个自定义请求头里带令牌。在 `session/new` 的 `mcpServers` 里以 `type: "http"` 挂上它，让 Agent 在一个回合里先调一个读工具再调一个写工具。记录：dsh 实际发来的请求序列（方法、是否带令牌头、是否发 GET 或 DELETE）、工具结果是否回到模型、`tool_call` 更新里的标题形状。
  2. **只读权限模式下 MCP 工具怎么被对待。** 以 Pith 现在启动 Agent 的同一方式（环境变量 `DSH_PERMISSION_MODE=read-only`）重复问题 1 的回合。记录三种可能里出现的是哪一种：向客户端发 `session/request_permission`、直接放行、直接拒绝。出现权限请求时，分别回答「一次性允许」与「一次性拒绝」各跑一遍，记录工具是否执行。同一模式下再让 Agent 尝试用它自带的工具写一个文件，记录是否被拦住、拦在哪一层。
  3. **停止。** 在工具调用进行中发送 `session/cancel`：`session/prompt` 多久返回、`stopReason` 是什么、已发出的更新是否完整到达、工具端点上进行中的请求怎么结束。
  4. **其他 Agent。** 本机装了 `claude-agent-acp` 或 `codex-acp` 的，对每一个只做 `initialize`，记录它声明的 `mcpCapabilities`。没装的写明没装，不安装。
- **交付物**：`.tmp/evidence/task-48/tool-endpoint-premises.md`，对上面四个问题逐个给出结论、依据的记录行号与没能覆盖的边界；最后一节写明 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.1 的启动检查、2.3 的标题判断与 2.4 的三层约束，哪些可以原样落地、哪些必须改、建议怎么改。
- **运行约束**：与 #45 相同。真实 dsh 在 `.tmp/runtime/task-48/` 下的独立工作目录运行；不读取、不输出凭据；不改模型与思考强度；每个请求有界，结束时回收自有进程与端口。
- **不在范围内**：修改 Pith 或 dsh 的被跟踪文件；实现工具端点。
- **Worker 门禁**：报告里的每个结论都能在留存的记录里按行号找到依据；没有运行覆盖的写「未覆盖」，不从源码推断后写成实测。
- **Tester 终验**：独立重跑问题 1 与问题 2 各一次，核对与报告一致；核对清理结果。

---

## [Task #49] 向导回合：工具端点、过程步骤、停止

- **Status**: queued
- **Depends-On**: #47 verified。（#46、#48 已 verified；Brain 已按 #48 的结论复核 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.1 至 2.6，见契约提交 `7446d5f`）
- **Verified-Commit**: none
- **Updated**: 2026-11-12
- **Scope**: `src/core/host.ts`、`src/core/seams.ts`、`src/core/engine/**`、`src/plugins/guide-acp/**`、`src/plugins/toolkit-*/**`（改用 `guide.prompt`）、`src/shells/**`、`src/workbench/**`（只做下面第 9 条的最小适配）、`tests/**`、`docs/ARCHITECTURE.md`（删差距行）
- **背景**：工具现在是回复末尾的文本围栏，写操作在回复结束后才执行，一个回合最多起四次 Agent 进程；回合不能停止，界面拿不到过程。
- **契约**：
  1. `ToolServerPort` 按 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 4 节加入 `HostPort`。实现放在 `src/shells/` 下，Web 壳与 Obsidian 壳共用：回环地址、随机端口、每次 `open` 一个随机令牌。
  2. 一个回合的流程、场景提示词、步骤来源、权限、工具表、期限与停止，按 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.1 至 2.6 落地。工具端点实现 2.1 第 2 步写明的最小子集。按 #48 的实测特别注意四点：端点要接受通知并处理 `notifications/cancelled`，对未知方法回「方法不存在」而不断开（dsh 会先发一个 `server/discover` 和一个 GET）；Pith 工具的事实以端点为准，标题按 2.3 登记的形状精确匹配，只有 dsh 登记；宿主的进程端口把工作区根目录加进系统沙盒的禁写路径，并为每个回合新建、结束后删除工作目录（2.4）；停止时进行中的调用按 2.6 结算。
  3. 删除：`pith-tool`、`pith-toolkits`、`pith-choices` 三种围栏的解析与提示词；四轮读取循环；读写分轮规则；`parseGuideReply`；`GuideProvider.reply`。
  4. 引擎按第 4 节的 `GuideTurn`、`TurnStep`、`TurnEffect`、`TurnOptions`、`GuideProvider.run`、`runTurn`、`retryTurn`、`getConversation` 落地。`sendMessage` 删除。本任务不做 `intake`、`capture` 与看板快照的新形状（#51）。
  5. 对话存到 `topics/topic-<id>/conversation.json`，格式按 3.5；`_cache/conversations/` 不再读写。
  6. `guide.prompt` 服务按 2.6 的 `AgentPromptService` 提供。行间翻译与后台的下一步行动改用它；`agentInterlineTranslator` 从向导插件的导出里删除，翻译提示词的拼装移进行间插件。
  7. 工具在本任务里仍面向「一个课题绑一份材料」的现状：读取工具作用于课题绑定的那份材料，`pith_write_lesson` 仍写进那份材料（没有时自动建一份）。`pith_create_topic` 与立项作用域不在本任务。工具名与参数形状按 2.5，只有这一条是暂时的出入，在 #51 消除。
  8. dsh 壳的工具由同一工厂生成（2.5 与第 4 节表格），删掉它自己重复定义的那几个。
  9. 工作台最小适配：向导栏能把回合显示出来（用户消息、回复的纯文本、选项），运行中按钮可停止，失败原因可见。过程行、Markdown、折叠与观感在 #50。Web 壳经服务端推送把回合更新送到浏览器，停止走单独的请求。
- **不在范围内**：#50 的界面；#51 的数据模型；费曼的新规程（现有的复述提交改成：记一条实训记录，再以复述为消息发起一个普通回合，原来的 `evaluationRubric` 文本经 `instruction` 传入）。
- **Worker 门禁**：`npm run test:browser`、`npm run build:obsidian`。用测试里可控的假 Agent 进程覆盖：一个回合内多次读取后写入；工具失败后模型继续；停止后回合为 `stopped` 且已生效的写入保留；进程中途退出为 `failed`；不带令牌的请求被拒；Agent 没声明所需能力或没登记标题形状时启动检查失败；标题只是以 Pith 工具名结尾、但不等于登记形状的权限请求被拒；停止时已开始落盘的写入做完并记为完成，未开始的不执行。在 macOS 上用真实子进程断言：沙盒内的进程写工作区根目录与绑定仓库都失败，写它自己的工作目录成功。手动破壁各一次：去掉令牌校验、让非 Pith 工具的权限请求被允许、把标题匹配放宽成后缀匹配、去掉工作区的禁写路径、让停止后的回合仍记为完成，对应回归变红。
- **Tester 终验**：两个宿主壳各用真实配置的 Agent：对一个绑了仓库的课题请向导走读并写一讲（确认读了多个文件且讲义落盘）；在回合进行中按停止；断开 Agent（设置里选一个不存在的）后发消息，看到明确的失败原因；重新请求后不出现第二条用户消息。另外明确要求向导「不用 Pith 的工具，直接用你自己的写文件工具在工作区里建一个文件」：文件没有出现，回合里能看到被拒绝；把实际观察到的拦截层写进报告（[ARCHITECTURE.md](ARCHITECTURE.md) 第六节「还没有实测的前提」第 2 条由此核销或改写）。
- **交付**：不交付。

---

## [Task #50] 向导栏：对话的显示

- **Status**: queued
- **Depends-On**: #49 verified
- **Verified-Commit**: none
- **Updated**: 2026-11-12
- **Scope**: `src/workbench/**`、`src/plugins/stage-reader/**`（Markdown 渲染）、`src/shells/**`（只为接线）、`tests/**`、`docs/ARCHITECTURE.md`（删差距行）
- **背景**：行为与观感以 dsh 的对话界面为基准。逐项对照与参考截图在 `.tmp/evidence/task-45/dsh-conversation-alignment.md` 与同目录 `screenshots/`；Pith 的取值已定在 [5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md) 第 6 节，两者不一致时以第 6 节为准。只对齐行为与观感，不引入 dsh 的代码。
- **契约**：
  1. 第 6 节 6.1 至 6.6 全部落地：回合的组成、过程组与折叠、可点的结果、运行中的状态与已用时间、三种结束状态、重新请求、按键、跟随滚动、观感取值、无障碍属性。
  2. [`renderMarkdown`](../src/plugins/stage-reader/index.ts) 的渲染范围按 [2-stages.md](subsystems/2-stages.md) 第 2 节：补上有序与无序列表（含嵌套）和 `http(s)` 链接。其余协议的链接显示为文本，原始 HTML 不作为标记渲染。讲义与回复用同一个渲染器；列表项与其他正文块一样带 `data-locator` 与 `data-prose`。
  3. 画像行在过程组之外单独成行、不随折叠消失，显示新增的那句话并带撤销；撤销调用 `removeObservation`，撤销后该行显示为已撤销；课题已沉淀后撤销仍可用。画像行只会出现在结题的回合。#47 第 8 条的守卫在这里放宽，允许工作台的撤销调用 `removeObservation`。
  4. 讲义行点击后在舞台打开该讲义；笔记行跳到原文。
- **不在范围内**：详略模式设置、排队发送、同轮插话、双击 `Esc` 停止、用量显示（均已在第 6 节明确不做）。
- **Worker 门禁**：`npm run test:browser`、`npm run build:obsidian`。浏览器用例覆盖：运行中、完成、失败、被停止四种状态的 DOM；读者向上滚动后新内容不带走视口；输入法组字期间回车不发送；链接只对 `http(s)` 生成 `<a>`。界面自拍明暗各一组存 `.tmp/evidence/task-50/`，并与 #45 的参考截图并排对看。
- **Tester 终验**：两个宿主壳、明暗两套、正常与窄栏，各用真实 Agent 跑一个带工具调用的回合，逐项核对第 6 节；截图归档供人类终审观感。
- **交付**：不交付。

---

## [Task #51] 内核：材料与课题分离

- **Status**: queued
- **Depends-On**: #50 verified
- **Verified-Commit**: none
- **Updated**: 2026-11-12
- **Scope**: `src/core/**`、`src/plugins/**`、`src/shells/**`、`src/workbench/**`（只做下面第 7 条的最小适配）、`tests/**`、`docs/ARCHITECTURE.md`（删差距行）
- **背景**：课题现在最多绑一份材料，讲义写进材料，锚点只有文件名。目标模型见 [PRODUCT.md](PRODUCT.md)「运转模型」。
- **契约**：
  1. 类型、磁盘格式与存储接口按 [1-core-store-engine.md](subsystems/1-core-store-engine.md) 第 2、3、4 节全部落地，包括 `shelved` 状态、`materialIds`、`lessons`、带来源的 `SelectionAnchor`、材料上的 `aids` 与 `notes`、`Note.result`、记录的 `author`。第 2 节的 9 条不变量各有回归。
  2. 旧格式不读取。旧工作区里的课题与材料出现在「无法读取」分区，原因由解析器给出。
  3. 引擎按第 4 节补齐 `intake`、`capture` 与新的看板快照（`shelved`、`library`）。`captureSelection` 删除。
  4. 向导工具按 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md) 2.5 的终态落地：`pith_create_topic` 与立项作用域；读取工具作用于课题引用的任意材料，非仓库材料经 `stage.reader` 取文本块；讲义写进课题的 `lessons/`；两个导入工具在两种作用域下的行为。#49 第 7 条的暂时出入到此消除。
  5. 场景提示词按 2.2 落地（多份材料、讲义清单、材料级记录、立项规则）。
  6. 守卫单测：除 `pith_create_topic` 外没有创建课题的调用点；除 `pith_settle_topic` 外没有把课题置为 `settled` 的调用点。
  9. 记录的作者（不变量 7）：`capture` 写入的记录作者是 `user`，向导工具写入的是 `guide`，工具参数里没有作者字段。结题门禁、「总结沉淀」快捷动作与新增观察的证据笔记只认作者为 `user` 的笔记与实训记录；《核心认知总结》的作者是 `guide`。「笔记」页签里向导写的记录带标记。
  7. 工作台最小适配：现有首页与课题内场景在新模型上能用。课题内的目录列出讲义与各份材料；仓库材料的文件能在舞台打开（[2-stages.md](subsystems/2-stages.md) 第 2 节第三层），讲义里的 `path:line` 出处可点。首页立项框只接受一句话目标（可带材料）并走 `intake`；只有材料没有目标的提交在本任务里提示「请写下想搞懂的问题」，不导入。材料库、材料阅读场景与单独投喂在 #52。
  8. 工具的归属拆分在 #52：本任务里行间仍在课题的 `toolkits` 里，材料的 `aids` 字段只读写、不驱动界面。
- **不在范围内**：#52 的界面；费曼的新规程（#53）。
- **Worker 门禁**：`npm run test:browser`、`npm run build:obsidian`。回归从磁盘字节构造：两个课题引用同一份材料，各自写讲义互不可见；同名文件分属两份材料时锚点各自回跳正确；`exploring → settled → exploring` 被拒绝；课题里只有向导写的笔记时结题被拒，再加一条用户写的笔记后通过；观察引用向导写的笔记被拒。手动破壁各一次：让讲义写进材料目录、让锚点丢掉来源、放开一个课题创建的旁路、让门禁把向导写的笔记算进去，对应回归变红。
- **Tester 终验**：两个宿主壳各用真实 Agent：用一句话目标加两个本地仓库立项，确认一个课题引用两份材料、大纲与第一讲在课题目录下；在两份材料的同名文件上各记一条笔记并回跳；再立一个引用其中一份材料的课题，确认两个课题的讲义与对话互不相见；搁置再恢复一个课题。
- **交付**：不交付。

---

## [Task #52] 工作台：材料库、材料阅读、立项与工具归属

- **Status**: queued
- **Depends-On**: #51 verified
- **Verified-Commit**: none
- **Updated**: 2026-11-12
- **Scope**: `src/workbench/**`、`src/shells/**`、`src/plugins/toolkit-*/**`、`src/core/seams.ts`（工具角色）、`tests/**`、`docs/ARCHITECTURE.md`（删差距行；全部清空时删除第六节）
- **契约**：
  1. 首页按 [5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md) 第 2 节：立项框的四种分流与多文件分组、立项的三种结果、三种状态的课题、材料库、封面缓存、无法读取分区。
  2. 材料阅读场景按第 3 节，包括材料级高亮与笔记、「以此立项」。
  3. 课题内按第 4 节：添加材料的四种来源、目录抽屉的两组、已沉淀课题只读。
  4. 工具归属按 [3-toolkits.md](subsystems/3-toolkits.md) 第 1、2 节与 3.1：描述符加 `role`；行间由 `material.aids` 驱动，入口在阅读菜单；训练工具菜单里没有行间；导入时按语言预置 `aids` 是唯一的启发式规则，`defaultToolkitsForMaterial` 与按材料类型预挂载训练工具的逻辑删除。
  5. 向导未连接时：投喂、阅读、高亮、材料级笔记、搁置与恢复可用；带目标的提交不可用并给出原因与设置入口。
- **不在范围内**：向导从材料库批量规划课题（另行立项）；删除课题或材料的界面。
- **Worker 门禁**：`npm run test:browser`、`npm run build:obsidian`。浏览器用例覆盖四种分流、多文件分组（音频加同名字幕合为一份）、立项失败后不留课题且输入回到立项框、材料库在 100 份材料下首页不读取原始文件（断言存储端口的读取调用）。界面自拍存 `.tmp/evidence/task-52/`。
- **Tester 终验**：两个宿主壳各用真实 Agent 走完整条路径：拖入一本外文 EPUB（进入材料阅读，行间可用，记一条笔记）；以此立项；课题内向导能读到那条笔记；添加第二份材料；搁置；在材料库里看到两份材料各自的引用数。再断开 Agent 重复投喂与阅读。截图归档供人类终审。
- **交付**：验收通过后执行 [ROLES.md](ROLES.md) 第 6 条。真实 Vault 里旧格式的课题与材料会出现在「无法读取」分区，这是预期结果，写进验收结果。

---

## [Task #53] 费曼复述：要点对照

- **Status**: queued
- **Depends-On**: #52 verified
- **Verified-Commit**: none
- **Updated**: 2026-11-12
- **Scope**: `src/plugins/toolkit-feynman/**`、`src/core/seams.ts`（`followUp`）、`src/workbench/**`、`src/shells/**`（只为接线）、`tests/**`、`docs/ARCHITECTURE.md`（删差距行）
- **背景**：现在的规程第一句是「先肯定复述中抓准的…」，附和有一部分是规程自己要求的。新规程见 [3-toolkits.md](subsystems/3-toolkits.md) 3.3，没有用真实模型验证过。
- **分两步，第一步不过不做第二步**：
  1. **只动提示词的实测。** 选 5 段原文（中文概念、英文概念、一段源码走读讲义、一段带限定条件的论述、一段很短的定义），每段准备 4 份复述：忠实的、说反一条的、漏掉一个前提的、换一套说法但意思正确的。用真实配置的 Agent 跑抽要点与对照，每个组合跑 3 次，留存全部输入输出。通过标准：说反的每次都有一条 `contradicted`；漏前提的每次都有对应的 `missing`；换说法的没有 `contradicted`，`missing` 不多于忠实复述；引用核对的丢弃率写进报告。达不到就改提示词重跑，最多三轮；三轮后仍达不到，标 `blocked`，附数据。
  2. **落地。** 按 3.3 的流程、降级与记录格式实现：打开遮罩即开始抽要点并缓存；对照请求只含原文、要点与复述；程序核对两类引用；逐条展示且没有计数与比例；`followUp` 生成追问指令；`evalMode`、`evaluationRubric` 与 `PITH_PRACTICE:` 前缀删除。
- **不在范围内**：按漏掉的要点安排复习（另行立项）。
- **Worker 门禁**：`npm run test:browser`、`npm run build:obsidian`。单测用固定的模型输出覆盖：引用不在原文里的要点被丢弃；复述里找不到的「原话」标为未能核对；抽要点失败时复述照常保存。界面与记录里不出现数字比例（断言 DOM 与落盘内容）。手动破壁：去掉引用核对后对应回归变红。
- **Tester 终验**：两个宿主壳各用真实 Agent，对同一段原文提交一份说反的和一份换说法的复述，核对逐条对照与追问只针对一个缺口；截图与第一步的实测数据一并归档。
- **交付**：验收通过后执行 [ROLES.md](ROLES.md) 第 6 条。

---
