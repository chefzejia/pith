# Architecture Overview

本文是 Pith 四层单向架构、插件能力模型、五个子系统的边界与数据所有权的总纲。产品定位与领域概念见 [`PRODUCT.md`](PRODUCT.md)，各功能的实现与验收状态见 [`FEATURES.md`](FEATURES.md)，任务队列见 [`TASKS.md`](TASKS.md)。

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
| `~/Library/Application Support/pith/repositories/` | Vault 外 Pith 克隆的 GitHub 仓库：每个版本一个快照（浅克隆）、不检出工作区，加上材料绑定提交的固定引用（或 `PITH_REPOSITORY_HOME`） | [`NodeRepositoryPort`](../src/shells/web/nodeRepository.ts) | 否：仓库材料指向这里。删除后这些材料读不出文件；重新导入同一链接会重新克隆，上游已改写掉的提交无法恢复 |

代码只读当前格式。已发布的磁盘格式只做加法，确需破坏性变更时随发布附一次性迁移脚本，先备份再迁移（[AGENTS.md](../AGENTS.md) 核心约束 3）。读不出来的条目由看板的「无法读取」分区列出。
