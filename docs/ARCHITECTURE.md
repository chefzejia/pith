# Architecture Overview

本文是 Pith 四层单向架构、插件能力模型（`Plugin = Stage | Toolkit + UI Protocol`）、五大垂直子系统边界与数据所有权的唯一总纲（Thin Reference）。产品定位与领域概念见 [`PRODUCT.md`](PRODUCT.md)，活跃任务队列见 [`TASKS.md`](TASKS.md)。

---

## 一、四层单向无环拓扑（Concentric 4-Layer DAG · 全 Shell 统一 UI）

Pith 将「纯文本领域内核」、「按需挂载的内置插件」、「全平台统一图形工作台（Workbench UI）」与「多态原生宿主薄壳」严格解耦。所有模块依赖遵循自外向内的单向无环图，并由 [`tests/boundaries.test.ts`](../tests/boundaries.test.ts) 在每次测试时静态锁死：

| 层级（自外向内单向依赖） | 目录与包含模块 | 架构角色与硬性边界 |
| :--- | :--- | :--- |
| **1. 多态原生宿主薄壳**<br>*(Shells · [`src/shells/`](../src/shells/))* | `obsidian/` · `web/` · `dsh/` · `speech/` | **唯一允许导入 `node:*` / `"obsidian"` / `@deepseek-ai/*` 的外层适配器**。实现 [`HostPort`](../src/core/host.ts)（含工作区文件存储、只读 Git 仓库绑定检视与进程/HTTP 端口）并将统一工作台挂载至各宿主容器。 |
| **2. 统一图形工作台层**<br>*(Workbench · `src/workbench/`)* | 首页统一立项看板 + 课题内五区统一界面（44px 顶栏、主视觉 `Stage` 容器、`Toolkit` 原位 `UI Protocol` 覆盖层、底部实心播客甲板、右侧向导栏与统一书卷 CSS） | **全 Shell（Obsidian / Web / DSH）共享的唯一一份前端 UI 与交互真源**。仅导入 `src/core/` 与 `src/plugins/` 并使用标准浏览器 DOM API，**严禁导入任何 `src/shells/`、`node:*`、`"obsidian"` 或 `@deepseek-ai/*`**。 |
| **3. 平级内置插件**<br>*(Plugins · [`src/plugins/`](../src/plugins/))* | • **呈现舞台 (`stage-*`)**<br>• **学习脚手架工具 (`dojo-*` / `Toolkit`)**<br>• **认知管家向导 (`guide-acp`)**<br>• **语音基础设施 (`speech-service`)** | **插件间 100% 物理隔离互不 `import`**，仅在 [`src/plugins/all.ts`](../src/plugins/all.ts) 汇总并经由 [`src/core/seams.ts`](../src/core/seams.ts) 协议通信，严禁导入 `workbench`、`shells` 或任何宿主包。 |
| **4. 零依赖领域内核**<br>*(Core · [`src/core/`](../src/core/))* | `types.ts` · `host.ts` · `seams.ts`<br>`pluginrt/` · `store/` · `engine/` | **零宿主依赖、零 UI 框架依赖、零特定隐喻污染**。定义领域实体、纯文本账本协议、去 Session 化注意力引擎与插件运行时。 |

---

## 二、插件能力解耦模型：`Plugin` · `Stage` · `Toolkit` · `UI Protocol`

除 `src/core/` 外，所有业务能力均以**插件（`Plugin`）**形式存在。为彻底消除“一个功能到底是舞台还是工具”的边界模糊，Pith 采用**协议驱动（Protocol-Oriented）**的双角色分层：

```text
插件 (Plugin · 物理代码包 src/plugins/<id>/)
 ├── 角色 A：舞台 (Stage · 画布渲染底板)
 │     职责：解决“我可以看/听什么”——将静态材料（EPUB/PDF/Markdown/代码/音视频/乐谱）
 │           渲染为带内在坐标 (IntrinsicLocator) 的可视画布与交互钩子。
 │
 └── 角色 B：脚手架工具 (Toolkit · 挂载在 topic.toolkits 上的学习与实训能力)
       职责：解决“我可以怎么学/怎么练”——由三部分协议组成：
       1. 启发式默认规则 (defaultFor)：显式资料导入但 Agent 未介入时，自动判定是否预挂载；
       2. 后端向导契约 (Guide Prompt & Tools)：向 Agent 声明何时增删此工具 (whenToUse) 及如何编排材料；
       3. 前端 UI 协议 (UI Protocol Overlay)：声明如何寄生在兼容 Stage 的目标块原位（如行间字幕层、
          影子跟读四阶同步与录音对比层、费曼遮罩阐述层），与底层 Stage 解耦复用。
```

- **正交与组合**：一个插件可以只贡献 `Stage`（如 `stage-reader`），可以只贡献跨舞台通用的 `Toolkit`（如 `dojo-feynman`），也可以在一个垂直领域插件中同时注册专属 `Stage` 与配套 `Toolkit`（如未来的音乐插件同时提供乐谱 `Stage` 与 MIDI 跟弹 `Toolkit`）。

---

## 三、五大垂直子系统地图（`docs/subsystems/`）

各子系统的详细契约、磁盘/协议格式、核心状态流转与验证命令按垂直机制拆分为 5 份薄契约文档：

| 子系统文档 | 对应人类训练阶段 | 覆盖源码目录 | 核心职责与关键契约 |
| :--- | :--- | :--- | :--- |
| **[1. 领域内核与工作区账本](subsystems/1-core-store-engine.md)** | **0. 算力调度与基座**<br>*(Compute & Base Weights)* | [`src/core/`](../src/core/)<br>（`store/` · `engine/` · `pluginrt/`） | 维护 `ME.md`、`topics/`、`materials/` 纯文本唯一事实源（[`MutationQueue`](../src/core/store/MutationQueue.ts) 串行写）；支持任意文件导入、课题自动创建材料包写讲义与 Git 仓库快照绑定；管理课题看板与副作用队列。 |
| **[2. 多模态阅读与媒体舞台 (`Stage`)](subsystems/2-stages.md)** | **1. 预训练**<br>*(Pre-training)* | [`src/plugins/stage-reader/`](../src/plugins/stage-reader/)<br>[`src/plugins/stage-timeline/`](../src/plugins/stage-timeline/) | 渲染 EPUB / PDF / CBZ / Markdown / 源码文本、内嵌教学块（[`extractTeachingBlocks`](../src/plugins/stage-reader/teachingBlocks.ts)）与音视频字幕流；维护跨字号/跨窗口稳定的内在位置坐标 [`IntrinsicLocator`](../src/core/types.ts) 并向 `Toolkit` 暴露原位挂载钩子。 |
| **[3. 学习脚手架工具 (`Toolkit` & `UI Protocol`)](subsystems/3-dojos.md)** | **1. Pre-train (输入降噪) & 3. RL (原位实训)** | `src/plugins/dojo-*/` | 包含启发式默认挂载判定、向导编排提示词与 Stage 原位 `UI Protocol` 覆盖层：覆盖输入降噪（`interline` 行间双语）、程序性声学跟练（`shadowing` 慢放/单句循环/边放边录/原声与自录回放对比/词级对齐）、生成式内化（`feynman` 合书阐述与苏格拉底追问）。 |
| **[4. 认知管家向导、课程拆解与按需语音](subsystems/4-guide-speech-shells.md)** | **2. SFT (课程拆解) & 4. Eval (毕业门禁)** | [`src/plugins/guide-acp/`](../src/plugins/guide-acp/)<br>[`src/plugins/speech-service/`](../src/plugins/speech-service/)<br>[`src/shells/`](../src/shells/) | 注入完整的**认知管家与三类课题课程拆解 Prompt**（针对庞大课题/代码仓规划《`00-课程大纲.md`》与递进讲义、提供仓库只读工具 `pith_list_repository_files` / `pith_read_repository_file`、支持多步工具读取回路、动态 CRUD `topic.toolkits`、输出 `pith-choices` 胶囊并守卫结题门禁）；管理本机神经语音守护进程。 |
| **[5. 统一图形工作台、立项入口与空间槽位](subsystems/5-spatial-ui-and-slots.md)** | **全流程交互表面**<br>*(Compass Intake & Workbench)* | `src/workbench/`<br>[`src/shells/`](../src/shells/) | 规定首页中央**统一立项/投喂台（Unified Intake）**与课题内五区空间拓扑（44px 顶栏、主视觉 Stage、底部唯一实心停靠播客甲板 `.pith-media-deck`、右侧向导栏、左侧材料与目录抽屉）、`Toolkit` 原位 `UI Protocol` 挂载矩阵与跨设备自适应几何布局。 |

---

## 四、数据与状态所有权

| 路径 / 存储位置 | 语义 | 唯一写入所有者 | 可否删除重建 |
| :--- | :--- | :--- | :--- |
| `<workspace>/ME.md` | 学习者个人认知基座权重画像 | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts) | **否** |
| `<workspace>/topics/topic-<id>/topic.md` | 探索课题元数据、`toolkits` 配置与高亮/笔记/实训诊断账本 | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts) | **否** |
| `<workspace>/materials/material-<id>/` | 材料元数据（`material.md`，含可选 `externalPath` / `commitSha`）、只读原始文件与向导生成的递进讲义（`files/`） | [`DefaultWorkspaceStore`](../src/core/store/WorkspaceStore.ts) | **否** |
| `<workspace>/_cache/` | 向导对话历史（`conversations/`）、副作用队列（`effects.json`）与双语缓存（`interline/`） | [`DefaultAttentionEngine`](../src/core/engine/AttentionEngine.ts) / [`InterlinePreparationCoordinator`](../src/plugins/dojo-interline/coordinator.ts) | **是**（删除后自动重建） |
| `~/Library/Application Support/pith/speech/` | Vault 外本机按需语音运行时与模型资产（或 `PITH_SPEECH_HOME`） | [`NodeManagedSpeechRuntime`](../src/shells/speech/speechRuntime.ts) | **是**（通过设置面板重装） |
