# Architecture Overview

本文是 Pith 三层单向架构、子系统边界、数据所有权与关键架构决策的唯一总纲（Thin Reference）。产品定位与领域概念见 [`PRODUCT.md`](PRODUCT.md)，活跃任务队列见 [`TASKS.md`](TASKS.md)。

---

## 一、三层单向无环拓扑（Concentric 3-Layer DAG）

Pith 将「纯文本领域内核」、「按需挂载的内置插件」与「多态原生宿主壳」严格解耦。所有模块依赖遵循自外向内的单向无环图，并由 [`tests/boundaries.test.ts`](../tests/boundaries.test.ts) 在每次测试时静态锁死：

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. 多态原生宿主壳 (Shells · src/shells/)                                     │
│    obsidian/ · web/ · dsh/ · speechRuntime.ts · interline.ts                │
│    [唯一允许导入 node:* / "obsidian" / @deepseek-ai/* 的外层，实现 HostPort] │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 组装并调用
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. 平级内置插件 (Plugins · src/plugins/) — 仅在 src/plugins/all.ts 汇总注册 │
│    ┌──────────────────┬───────────────────────┬──────────────────────────┐  │
│    │ 舞台 (Stages)    │ 实训道场 (Dojos)      │ 向导与语音底座           │  │
│    │ • stage-reader   │ • dojo-interline      │ • guide-acp              │  │
│    │ • stage-timeline │ • dojo-feynman        │ • speech-service         │  │
│    │                  │ • dojo-shadowing      │                          │  │
│    └──────────────────┴───────────────────────┴──────────────────────────┘  │
│    [插件间 100% 物理隔离互不 import，仅通过 src/core/seams.ts 服务栈通信]   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ 仅导入 src/core/
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. 零依赖领域内核 (Core · src/core/)                                         │
│    types.ts · host.ts · seams.ts · pluginrt/ · store/ · engine/             │
│    [零宿主依赖、零 UI 框架依赖、零特定隐喻污染]                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

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
| `~/Library/Application Support/pith/speech/` | Vault 外本机 `sherpa-onnx` 语音引擎与模型资产（或 `PITH_SPEECH_HOME`） | [`NodeManagedSpeechRuntime`](../src/shells/speechRuntime.ts) | **是**（通过设置面板重装） |

---

## 四、关键架构决策（已落地现状）

### 1. 直接重构原函数，严禁重赋值包装链与源码字符串 VM 假测试
- **当前决定**：修改宿主或插件函数时直接编辑唯一函数定义；测试直接导入真实模块或驱动真实浏览器/客户端 DOM。
- **淘汰的替代方案**：
  - **`const fnBase = fn; fn = ...` 同名重赋值套娃**：外层套娃会让旧死代码残留，导致单测测旧分支而生产环境跑外层补丁。
  - **`readFile("src/...") + vm.runInContext`**：抠取源码行塞入 VM 会反向绑架代码排版，且无法暴露真实 DOM 与事件传播缺陷。
- **守卫门禁**：[`tests/boundaries.test.ts`](../tests/boundaries.test.ts) 中的 `source does not retain Base aliases for function wrappers`、`Web reader entry points have one definition and are never reassigned` 与 `tests do not execute extracted source in a VM`。

### 2. 标准 ACP 协议发现与 Vault 外零 Python 原生语音守护进程
- **当前决定**：向导模型与推理强度列表 100% 通过标准 ACP `session/new` 的 `configOptions` 与 `session/set_config_option` 交互；本机语音采用零 Python 依赖的原生推理运行时与按需守护进程（空闲自动退出释放内存，具体模型与空闲配置见 [`NodeManagedSpeechRuntime`](../src/shells/speechRuntime.ts)）。
- **淘汰的替代方案**：
  - **解析 `~/.dsh/` 等特定 Agent 私有配置文件**：破坏宿主无关性，无法通用于不同 ACP Agent。
  - **系统 `speechSynthesis` 或运行时 `python3 -m venv` + `pip`**：系统内置 TTS 机械劣质，而运行时调 `pip` 依赖宿主机 Python 环境且极易因网络或编译失败崩溃。
- **守卫门禁**：[`tests/boundaries.test.ts`](../tests/boundaries.test.ts) 中的 `managed speech uses native multilingual models and ACP never reads dsh private configuration` 与 `Zero OS-TTS & External Repo Coupling`。
