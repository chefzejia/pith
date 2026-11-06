# Architecture Overview

本文是 Pith 三层单向架构、五大垂直子系统边界与数据所有权的唯一总纲（Thin Reference）。产品定位与领域概念见 [`PRODUCT.md`](PRODUCT.md)，活跃任务队列见 [`TASKS.md`](TASKS.md)。

---

## 一、三层单向无环拓扑（Concentric 3-Layer DAG）

Pith 将「纯文本领域内核」、「按需挂载的内置插件」与「多态原生宿主壳」严格解耦。所有模块依赖遵循自外向内的单向无环图，并由 [`tests/boundaries.test.ts`](../tests/boundaries.test.ts) 在每次测试时静态锁死：

| 层级（自外向内单向依赖） | 目录与包含模块 | 架构角色与硬性边界 |
| :--- | :--- | :--- |
| **1. 多态原生宿主壳**<br>*(Shells · [`src/shells/`](../src/shells/))* | `obsidian/` · `web/` · `dsh/`<br>`speechRuntime.ts` · `voiceInput.ts` · `interlineView.ts` · `dojoView.ts` | **唯一允许导入 `node:*` / `"obsidian"` / `@deepseek-ai/*` 的外层**。实现 [`HostPort`](../src/core/host.ts)，组装宿主运行环境并渲染各平台界面。 |
| **2. 平级内置插件**<br>*(Plugins · [`src/plugins/`](../src/plugins/))* | • **主视觉舞台 (`stage-*`)**：`stage-reader` · `stage-timeline`<br>• **按课题注入工具 (`dojo-*`)**：`dojo-interline` · `dojo-shadowing` · `dojo-feynman`<br>• **AI 向导协同 (`guide-*`)**：`guide-acp`<br>• **语音基础设施 (`speech-*`)**：`speech-service` | **插件间 100% 物理隔离互不 `import`**，仅在 [`src/plugins/all.ts`](../src/plugins/all.ts) 汇总并经由 [`src/core/seams.ts`](../src/core/seams.ts) 服务栈通信，严禁导入任何宿主包。 |
| **3. 零依赖领域内核**<br>*(Core · [`src/core/`](../src/core/))* | `types.ts` · `host.ts` · `seams.ts`<br>`pluginrt/` · `store/` · `engine/` | **零宿主依赖、零 UI 框架依赖、零特定隐喻污染**。定义领域实体、纯文本账本协议、去 Session 化注意力引擎与插件运行时。 |

---

## 二、五大垂直子系统地图（`docs/subsystems/`）

各子系统的详细目录结构、磁盘/协议格式、核心状态流转与验证命令按垂直机制拆分为 5 份薄契约文档：

| 子系统文档 | 对应人类训练阶段 | 覆盖源码目录 | 核心职责与关键契约 |
| :--- | :--- | :--- | :--- |
| **[1. 领域内核与工作区账本](subsystems/1-core-store-engine.md)** | **0. 算力调度与基座**<br>*(Compute & Base Weights)* | [`src/core/`](../src/core/)<br>（`store/` · `engine/` · `pluginrt/`） | 维护 `ME.md`、`topics/`、`materials/` 纯文本唯一事实源（[`MutationQueue`](../src/core/store/MutationQueue.ts) 串行写）；计算首页注意力罗盘与 `_cache/effects.json` 同键合并副作用队列；管理插件 4 层配置合成与 `inUse` 传递保活。 |
| **[2. 预训练阅读与媒体舞台](subsystems/2-stages.md)** | **1. 预训练**<br>*(Pre-training)* | [`src/plugins/stage-reader/`](../src/plugins/stage-reader/)<br>[`src/plugins/stage-timeline/`](../src/plugins/stage-timeline/) | 渲染 EPUB / PDF / CBZ / Markdown、内嵌教学块（`teachingBlocks.ts`）与音视频字幕流；维护跨字号/跨窗口稳定的内在位置坐标 [`IntrinsicLocator`](../src/core/types.ts)；执行多栏黄金版心分页恒等式与 EPUB 命名空间安全净化。 |
| **[3. 认知工具与后训练道场](subsystems/3-dojos.md)** | **1. Pre-train (输入脚手架) & 3. RL (产出实训)** | [`src/plugins/dojo-interline/`](../src/plugins/dojo-interline/)<br>[`src/plugins/dojo-feynman/`](../src/plugins/dojo-feynman/)<br>[`src/plugins/dojo-shadowing/`](../src/plugins/dojo-shadowing/) | 由向导按课题意图注入 `topic.toolkits`：输入降噪（行间双语滑动预热）、程序性复现（跟读与词级对齐 `evalMode: "deterministic"`）、生成式内化（撤拐杖阐述与教练追问 `evalMode: "guide-rubric"`）。 |
| **[4. 标准 ACP 向导、按需语音与宿主壳](subsystems/4-guide-speech-shells.md)** | **2. SFT & 4. Eval**<br>*(Demonstration & Gate)* | [`src/plugins/guide-acp/`](../src/plugins/guide-acp/)<br>[`src/plugins/speech-service/`](../src/plugins/speech-service/)<br>[`src/shells/`](../src/shells/) | 通过标准 ACP JSON-RPC stdio 接入本机 Agent、解析三种尾部围栏（`pith-choices` / `pith-toolkits` / `pith-tool`）并守卫结题硬门禁（`pith_settle_topic`）；管理 Vault 外零 Python 依赖的本机按需神经语音守护进程；适配 Obsidian、Web 与 DSH 三种原生宿主壳。 |
| **[5. 空间布局、视觉系统与工具槽位注入](subsystems/5-spatial-ui-and-slots.md)** | **全流程交互表面**<br>*(Spatial Surface & Slots)* | [`src/shells/obsidian/plugin.ts`](../src/shells/obsidian/plugin.ts)<br>[`src/shells/web/server.ts`](../src/shells/web/server.ts)<br>[`src/shells/toolkitSlot.ts`](../src/shells/toolkitSlot.ts) | 规定五区空间拓扑（44px 顶栏、主视觉 Stage、底部唯一实心停靠播客甲板 `.pith-media-deck`、右侧默认收起向导栏、左侧目录抽屉）、工具多点位空间注入矩阵、跨设备连续几何自适应算法（[`resolveResponsiveLayout`](../src/plugins/stage-reader/pagination.ts)）与宿主主题继承视觉体系。 |

---

## 三、数据与状态所有权

| 路径 / 存储位置 | 语义 | 唯一写入所有者 | 可否删除重建 |
| :--- | :--- | :--- | :--- |
| `<workspace>/ME.md` | 学习者个人认知基座权重画像 | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts) | **否** |
| `<workspace>/topics/topic-<id>/topic.md` | 探索课题元数据与高亮/笔记/实训诊断账本 | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts) | **否** |
| `<workspace>/materials/material-<id>/` | 材料元数据（`material.md`）与 100% 只读原始文件包（`files/`） | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts) | **否** |
| `<workspace>/_cache/` | 向导对话历史（`conversations/`）、副作用队列（`effects.json`）与双语缓存（`interline/`） | [`DefaultAttentionEngine`](../src/core/engine/AttentionEngine.ts) / [`InterlinePreparationCoordinator`](../src/plugins/dojo-interline/coordinator.ts) | **是**（删除后自动重建） |
| `~/Library/Application Support/pith/speech/` | Vault 外本机语音引擎与模型资产（或 `PITH_SPEECH_HOME`） | [`NodeManagedSpeechRuntime`](../src/shells/speech/speechRuntime.ts) | **是**（通过设置面板重装） |
