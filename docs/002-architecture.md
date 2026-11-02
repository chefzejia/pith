# 002 Architecture

本文档将 [000 Philosophy](000-philosophy.md) 与 [001 Domain Model](001-domain.md) 映射为永久性的模块职责、命名分类与自动化测试门禁。

## 1. 同心圆三层架构（Core · Plugins · Shells）

Pith 采用受 `magpie` 与 `dsh-superagent` 启发的同心圆三层架构：

```text
================================================================================
 第三层：多态原生宿主壳 (src/shells/*) —— 实现 HostPort，渲染或桥接各平台原生体验
   [ shells/web ]           [ shells/obsidian ]         [ shells/dsh ]
   独立 Web / 桌面窗口壳      Obsidian 插件适配器         DeepSeek Harness 工具包壳
================================================================================
                                      │
                                      ▼ 注入 HostPort & 驱动 PluginRuntime
================================================================================
 第二层：平级可插拔内置插件 (src/plugins/*) —— 互不 import，由工程解耦与 Agent 动态调度驱动
   ┌──────────────────┬──────────────────┬──────────────────┬─────────────────┐
   │ 主视觉区 stage-* │ 主动功能区 dojo-*│ 辅助协同区 guide-*│ 公共底座 *-service│
   │ - stage-reader   │ - dojo-shadowing │ - guide-acp      │ - speech-service│
   │ - stage-timeline │ - dojo-feynman   │   (向导协同面板)  │   (TTS & ASR)   │
   └──────────────────┴──────────────────┴──────────────────┴─────────────────┘
================================================================================
                                      │
                                      ▼ 仅导入 src/core/*
================================================================================
 第一层：绝对内核 (src/core/*) —— 零宿主依赖、零 UI 框架依赖、零隐喻污染
   - core/types.ts & seams.ts : 四大领域实体与 Capability Seam 服务定义契约
   - core/host.ts             : HostPort 窄接口 (Storage, Http, Secrets, Sanitizer)
   - core/pluginrt/           : 插件注册、Compose 算账、Reconcile 调和、ViewKernel
   - core/store/              : WorkspaceStore (Markdown 唯一事实源 + MutationQueue)
   - core/engine/             : AttentionEngine (去 Session 化罗盘 + Effects 合并队列)
================================================================================
```

## 2. 内核三大支柱职责（`src/core/`）

1. **`pluginrt/`（插件运行时总管）**：
   - **同步注册与栈式接管（Service Stacking）**：`apply(ctx)` 零毫秒同步完成注册，消除并发注册竞态；同名服务入栈管理（栈顶生效，卸载时仅弹出自身并无缝回退至下层备选实现），仅当最后一个提供者卸载时才按逆序（`newest first`）级联卸载下游消费者。
   - **异常隔离回滚（Undo on Failure）**：单个插件 `apply` 抛错时立即逆序撤销其半途注册项并标为 `failed`，不阻断其他插件运行。
   - **存档感知与依赖链传递保活（Transitive `InUse` Guard）**：`compose()` 按 `default -> preset -> user -> in-use` 四层算账；只要用户存档正在使用某插件（`inUse() > 0` 或状态未知），不仅强制保活该插件，还沿 `requires -> provides` 自动开启其所需的底层服务插件。
2. **`store/`（纯文本存档读写器）**：
   - `DefaultWorkspaceStore` 是 `ME.md`、`topics/`、`materials/` 的唯一写入者；
   - 所有异步写操作经由同一 `MutationQueue` 单通道排队执行，根绝并发 `read -> modify -> write` 覆盖丢数据；扫描列表时自动隔离跳过单个损坏文件。
3. **`engine/`（去 Session 化注意力引擎）**：
   - 借鉴 `dsh-superagent`：对外只暴露领域动作（读取首页罗盘 `compass()`、秒存高亮与笔记 `captureSelection()`），绝不让前台界面阻塞等待 AI 会话；
   - 后台异步工作统一写入 `_cache/effects.json` 持久化队列，按 `(kind, key)` 自动合并去重（Coalesce：同一课题连续划多条笔记只合并触发一次下一步建议计算）；无 AI 配置时 100% 离线降级可用。

## 3. 插件层四类命名与「Agent 驱动编排」铁律（`src/plugins/`）

> **核心哲学纠偏**：Pith 的插件化架构（`PluginRuntime`）是**为了研发解耦（支持多 Agent 并行独立开发）与运行时由 AI 向导动态为用户按需挂载工具**，**绝不是让人类用户在设置面板里手工勾选开关底层插件**！所有内置插件在内核启动时默认就绪，界面上严禁向用户暴露 `stage-reader`、`speech-service` 等底层插件开关列表或 `preset: all/essentials` 选择器。

所有内置插件遵循统一的**前缀语义契约**，通过 [`src/core/seams.ts`](../src/core/seams.ts) 中定义的标准接口协作：

| 前缀分类 | 界面与架构定位 | 现有内置插件 | 核心设计准则 |
| :--- | :--- | :--- | :--- |
| **`stage-*`** | **主视觉呈现区（Primary Stage）** | `stage-reader`（文档/电子书）<br>`stage-timeline`（音视频时间轴） | 根据当前 `Material` 的格式自动调度呈现，向上汇报与屏幕尺寸无关的内在位置 `IntrinsicLocator` 与选区锚点 `SelectionAnchor`。 |
| **`dojo-*`** | **主动实训功能区（Active Dojo）** | `dojo-shadowing`（外语 4 阶跟读）<br>`dojo-feynman`（费曼盲写复述） | **由 Agent（或课题意图）通过 `topic.toolkits` 动态按需挂载**；对不涉及该实训的课题默认隐藏，遵循 `拆解 -> 跟练 -> 骨干挖空 -> 盲产诊断` 四阶撤拐杖规律。 |
| **`guide-*`** | **Agent 辅助协同区（AI Guide）** | `guide-acp`（向导与课程教练） | 结合 `ME.md` 因人施教，感知系统可用 `Dojo` 工具清单并帮用户动态挂载，消费后台 `Effects` 队列，通过深水区毕业一问（Settlement Gate）把关课题沉淀。 |
| **`*-service`** | **无界面公共能力底座** | `speech-service`（分句 TTS 与本地回环 ASR） | 不直接占据主界面区域，向多个上层 `stage-*` 或 `dojo-*` 插件提供共享底层服务（如本地回环安全校验与音频能力）。 |

## 4. 架构门禁测试（Architecture Gates）

- [`tests/boundaries.test.ts`](../tests/boundaries.test.ts)：强制校验 `core` 不导插件或壳、插件互不导入、`plugins/all.ts` 全量收录、宿主包零泄漏、核心层零旧隐喻残留、以及编号文档零前向引用。
- [`tests/pluginrt.test.ts`](../tests/pluginrt.test.ts)、[`tests/store.test.ts`](../tests/store.test.ts)、[`tests/engine.test.ts`](../tests/engine.test.ts)、[`tests/web-shell.test.ts`](../tests/web-shell.test.ts)、[`tests/plugins-and-shells.test.ts`](../tests/plugins-and-shells.test.ts)：端到端验证微内核、存储并发安全、去 Session 化队列、四阶实训算法以及 Web / Obsidian / DSH 三壳共享同一工作区目录实时互通。
