# Architecture Overview

本文是 Pith 四层单向架构、插件能力模型、五个子系统的边界与数据所有权的总纲。产品定位与领域概念见 [`PRODUCT.md`](PRODUCT.md)，任务队列见 [`TASKS.md`](TASKS.md)。

---

## 一、四层单向无环拓扑

Pith 把纯文本领域内核、按需挂载的内置插件、全平台统一工作台与宿主薄壳分开。依赖只能自外向内，由 [`tests/boundaries.test.ts`](../tests/boundaries.test.ts) 在每次测试时静态检查：

| 层级（自外向内） | 目录 | 角色与边界 |
| :--- | :--- | :--- |
| **1. 宿主薄壳**<br>*(Shells · [`src/shells/`](../src/shells/))* | `obsidian/` · `web/` · `dsh/` · `speech/` | **唯一允许导入 `node:*`、`"obsidian"`、`@deepseek-ai/*` 的外层适配器**。实现 [`HostPort`](../src/core/host.ts)（文件存储、只读 Git 仓库检视、Agent 进程、HTTP、本机工具端点），把统一工作台挂到各宿主容器里。 |
| **2. 统一工作台**<br>*(Workbench · `src/workbench/`)* | 首页、材料阅读、课题内三个场景的唯一一份界面 | **全部宿主壳共用的前端真源**。只导入 `src/core/` 与 `src/plugins/`，只用标准浏览器 DOM API，不导入 `src/shells/`、`node:*`、`"obsidian"` 或 `@deepseek-ai/*`。 |
| **3. 内置插件**<br>*(Plugins · [`src/plugins/`](../src/plugins/))* | 舞台（`stage-*`）· 工具（`toolkit-*`）· 向导（`guide-acp`）· 语音（`speech-service`） | **插件之间不互相导入**，只在 [`src/plugins/all.ts`](../src/plugins/all.ts) 汇总，经 [`src/core/seams.ts`](../src/core/seams.ts) 的服务协议通信；不导入 `workbench`、`shells` 或任何宿主包。 |
| **4. 领域内核**<br>*(Core · [`src/core/`](../src/core/))* | `types.ts` · `host.ts` · `seams.ts`<br>`pluginrt/` · `store/` · `engine/` | **零宿主依赖、零 UI 框架依赖**。定义领域实体、纯文本账本协议、注意力引擎与插件运行时。 |

---

## 二、领域模型与两条外部协议

三个实体，课题引用材料：

```text
Profile (ME.md, 永久) ◀── 观察条目 ── Topic (临时) ── 引用 0..N ──▶ Material (永久)
                                        ├ lessons/
                                        ├ conversation.json
                                        └ notes
```

四个动作里，投喂和阅读不需要向导，立项和结题需要（[`PRODUCT.md`](PRODUCT.md)「运转模型」）。

向导是本机的外部 Agent 进程。Pith 与它之间只有两条标准协议，都由 `guide-acp` 插件实现：

```text
Pith ── ACP（stdio）──────────────▶ Agent      会话、提示词、过程更新、权限请求
Pith ◀─ MCP（回环 HTTP，Pith 为服务端）── Agent      Pith 工具的发现与调用
```

Pith 不解析回复文本里的指令，不读取任何 Agent 的私有配置文件。

---

## 三、插件能力模型

除 `src/core/` 外，业务能力都以插件形式存在。一个插件向系统贡献以下角色中的一个或几个：

```text
插件 (src/plugins/<id>/)
 ├── 舞台 (Stage)
 │     把一个文件渲染成带内在坐标 (IntrinsicLocator) 的画布，并暴露原位挂载的锚点。
 │     舞台不知道课题。
 │
 └── 工具 (Toolkit)，以原位覆盖层寄生在舞台上，分两种：
       ├── 阅读辅助 (aid)       挂在材料上 (material.aids)，只产生可重建的缓存。
       └── 训练工具 (training)  挂在课题上 (topic.toolkits)，产生归课题的实训记录；
                                向导描述符里的 whenToUse 告诉向导何时挂载它。
```

- 一个插件可以只贡献舞台（`stage-reader`），只贡献工具（`toolkit-feynman`），或在一个垂直领域里同时贡献两者（如未来的乐谱舞台加 MIDI 跟弹）。
- 需要调用模型的插件经 `guide.prompt` 服务发一次性请求，不导入 `guide-acp`。

---

## 四、子系统地图（`docs/subsystems/`）

| 子系统 | 训练阶段 | 源码目录 | 职责 |
| :--- | :--- | :--- | :--- |
| **[1. 领域内核与工作区账本](subsystems/1-core-store-engine.md)** | 算力调度与基座 | [`src/core/`](../src/core/) | 三个实体的类型与磁盘格式，[`MutationQueue`](../src/core/store/MutationQueue.ts) 串行写；立项、课题回合与看板快照；后台任务队列；冻结的内核契约 |
| **[2. 舞台](subsystems/2-stages.md)** | 预训练 | [`src/plugins/stage-reader/`](../src/plugins/stage-reader/)<br>[`src/plugins/stage-timeline/`](../src/plugins/stage-timeline/) | 渲染 EPUB、PDF、CBZ、Markdown、源码文本、仓库文件与音视频字幕流；维护跨字号与窗口稳定的 [`IntrinsicLocator`](../src/core/types.ts) |
| **[3. 阅读辅助与训练工具](subsystems/3-toolkits.md)** | 预训练（降噪）与强化学习 | `src/plugins/toolkit-*/` | `interline` 行间双语；`shadowing` 影子跟读；`feynman` 复述的要点对照规程 |
| **[4. 向导、语音与宿主壳](subsystems/4-guide-speech-shells.md)** | 监督微调与评测 | [`src/plugins/guide-acp/`](../src/plugins/guide-acp/)<br>[`src/plugins/speech-service/`](../src/plugins/speech-service/)<br>[`src/shells/`](../src/shells/) | 一个回合的 ACP 与 MCP 流程、场景提示词、工具表、权限、期限与停止；本机神经语音守护进程；三个宿主壳 |
| **[5. 统一工作台](subsystems/5-spatial-ui-and-slots.md)** | 全流程交互表面 | `src/workbench/`<br>[`src/shells/`](../src/shells/) | 首页、材料阅读、课题内三个场景；立项框的分流；工具挂载点；对话的显示规则；自适应布局 |

---

## 五、数据与状态所有权

| 路径 | 内容 | 唯一写入者 | 可否删除重建 |
| :--- | :--- | :--- | :--- |
| `<workspace>/ME.md` | 画像：你写的部分与向导的观察条目 | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts)（只改观察一节） | 否 |
| `<workspace>/history/` | 程序改写 `ME.md` 之前的各个上一版 | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts) | 否 |
| `<workspace>/materials/material-<id>/` | 材料元数据、只读原始文件、阅读位置、阅读辅助、材料级高亮与笔记 | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts) | 否 |
| `<workspace>/topics/topic-<id>/topic.md` 与 `lessons/` | 课题元数据、材料引用、训练工具、讲义、高亮/笔记/实训记录 | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts) | 否 |
| `<workspace>/topics/topic-<id>/conversation.json` | 课题的对话回合 | [`DefaultAttentionEngine`](../src/core/engine/AttentionEngine.ts) | 否 |
| `<workspace>/_cache/` | 后台任务队列、行间译文、复述要点清单、封面缩略图 | 各自的所有者（引擎、`toolkit-interline`、`toolkit-feynman`、工作台） | 是，删除后自动重建 |
| `~/Library/Application Support/pith/speech/` | Vault 外的本机语音运行时与模型（或 `PITH_SPEECH_HOME`） | [`NodeManagedSpeechRuntime`](../src/shells/speech/speechRuntime.ts) | 是，经设置面板重装 |

磁盘格式没有版本迁移。格式变更后，旧工作区里读不出来的条目由看板的「无法读取」分区列出。

---

## 六、契约先于实现的部分

`docs/` 描述的是目标契约。下表列出源码尚未落地的部分；每项落地并通过验收后，由完成它的任务删掉对应的行。表为空时删除本节。审计以本表为准：表中列出的差距不算契约漂移。

| 差距 | 契约出处 | 源码现状 | 任务 |
| :--- | :--- | :--- | :--- |
| 画像只增删观察条目，写前留底 | [1-core](subsystems/1-core-store-engine.md) 3.4 | `pith_settle_topic` 整篇替换 `ME.md`（[`tools.ts`](../src/plugins/guide-acp/tools.ts)） | #47 |
| Pith 工具以 MCP 服务提供；一个回合一次 `session/prompt` | [4-guide](subsystems/4-guide-speech-shells.md) 2.1 至 2.5 | `mcpServers` 为空；工具是回复末尾的文本围栏，一个回合最多起四次 Agent 进程（[`acpSession.ts`](../src/plugins/guide-acp/acpSession.ts)） | #49 |
| 回合带过程步骤、可停止、可重新请求；前台回合不设期限 | [1-core](subsystems/1-core-store-engine.md) 第 4 节，[5-workbench](subsystems/5-spatial-ui-and-slots.md) 第 6 节 | `GuideProvider.reply` 只返回字符串，不接受取消；向导栏按纯文本显示，只有一行等待提示 | #49（引擎与停止）、#50（界面） |
| 材料与课题分离：课题引用多份材料、讲义与对话归课题、锚点带来源、`shelved` 状态 | [1-core](subsystems/1-core-store-engine.md) 第 2 至 4 节 | 课题最多绑一份材料；讲义写进材料；对话在 `_cache/`；锚点只有文件名 | #49（对话）、#51（其余） |
| 立项只经向导；材料库；材料阅读场景 | [5-workbench](subsystems/5-spatial-ui-and-slots.md) 第 2、3 节 | 拖入文件即建课题；首页只列课题；没有课题外的阅读 | #52 |
| 行间挂在材料上；没有按材料类型预挂载训练工具 | [3-toolkits](subsystems/3-toolkits.md) 第 2 节 | 三个工具都在 `topic.toolkits`，按材料类型预挂载（[`toolkitSlot.ts`](../src/workbench/toolkitSlot.ts)） | #52 |
| 费曼复述的要点对照规程 | [3-toolkits](subsystems/3-toolkits.md) 3.3 | 一段「先肯定、再指出、再追问」的自由文本规程 | #53 |
| 回复与讲义渲染列表和链接 | [2-stages](subsystems/2-stages.md) 第 2 节 | [`renderMarkdown`](../src/plugins/stage-reader/index.ts) 不识别列表与链接 | #50 |
| 仓库文件可在舞台打开 | [2-stages](subsystems/2-stages.md) 第 2 节 | 仓库材料只有空态页，文件只有向导工具能读 | #51 |
| 看板封面读缓存 | [5-workbench](subsystems/5-spatial-ui-and-slots.md) 2.3 | 每次打开看板读每份材料的整个文件取封面（[`boardMaterials.ts`](../src/workbench/boardMaterials.ts)） | #52 |

**动手之前必须先实测的三个前提**（只读过源码或文档，没有运行过）。前提 1、2 与下面关于其他 Agent 的一句由 #48 实测，前提 3 由 #53 在动界面之前实测：

1. dsh 的 ACP 服务声明支持 HTTP 方式的 MCP 服务；任务 #45 实测的是 stdio 方式。工具端点的设计建立在 HTTP 方式可用之上。若实测不可用，改为由宿主提供一个转发用的 stdio 可执行文件，[4-guide](subsystems/4-guide-speech-shells.md) 2.1 的启动检查随之修改。
2. dsh 在只读权限模式下如何对待 MCP 工具：是向 Pith 发权限请求，还是直接放行或直接拒绝。任务 #45 的实测没有出现权限请求，实测记录里也没有那次运行的权限模式。若是直接拒绝，2.4 的第一层约束要换成别的方式。
3. 费曼的对照规程能否稳定地区分「说反」「漏掉」与「换了说法但正确」。验收方式写在 [3-toolkits](subsystems/3-toolkits.md) 3.3。

claude 与 codex 的 ACP 适配器是否支持 HTTP 方式的 MCP 服务也没有核实。不支持的 Agent 在启动检查里报不可用。
