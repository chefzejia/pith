# Architecture Overview

## 系统目标与三层单向依赖（Concentric 3-Layer DAG）

Pith 将纯文本领域内核、可插拔能力插件与多态原生宿主壳严格解耦，所有依赖关系遵循自外向内的单向无环图（由 [`tests/boundaries.test.ts`](../tests/boundaries.test.ts) 在每次测试时静态锁死）：

1. **多态原生宿主壳（Shells · [`src/shells/`](../src/shells/)）**：`obsidian`、`web`、`dsh` —— 实现 [`HostPort`](../src/core/host.ts) 并在入口显式组装运行环境，驱动插件注册表 [`src/plugins/all.ts`](../src/plugins/all.ts)。
2. **平级内置插件（Plugins · [`src/plugins/`](../src/plugins/)）**：`stage-reader`、`stage-timeline`、`dojo-interline`、`dojo-shadowing`、`dojo-feynman`、`guide-acp`、`speech-service` —— 互不导入、不导入任何宿主包（`node:*` / `"obsidian"` / `@deepseek-ai/*`），仅通过 [`src/core/seams.ts`](../src/core/seams.ts) 的能力契约通信。
3. **零依赖领域内核（Core · [`src/core/`](../src/core/)）**：[`types.ts`](../src/core/types.ts)、[`seams.ts`](../src/core/seams.ts)、[`host.ts`](../src/core/host.ts)、[`pluginrt/`](../src/core/pluginrt/)、[`store/`](../src/core/store/)、[`engine/`](../src/core/engine/) —— 零宿主依赖、零 UI 框架依赖、零隐喻污染。

## 子系统薄契约

### 1. 插件运行时（`PluginRuntime`）

- **职责与边界**：管理插件同步注册、配置热重挂、服务栈式接管与存档 `InUse` 传递保活；不关心具体业务或宿主 UI。
- **唯一事实源**：[`src/core/pluginrt/runtime.ts`](../src/core/pluginrt/runtime.ts) 中的 `PluginRuntime` 与 `compose`
- **核心运行路径与状态流转**：`compose()` 按 `default -> preset -> user -> in-use` 计算目标开启集；`reconcile()` 比对激活状态与已应用的 `config` 快照——当配置变更时自动停用并按依赖拓扑重新挂载插件及其下游消费者。
- **失败与兼容语义**：单个插件 `apply(ctx)` 抛错时立即逆序回滚其半途注册项并标记为 `failed`，不阻断其余插件。
- **验证命令**：`node --experimental-strip-types --test tests/pluginrt.test.ts`

### 2. 纯文本工作区账本（`WorkspaceStore`）

- **职责与边界**：作为 `ME.md`、`topics/`、`materials/` 的唯一写入通道，维护纯文本 Markdown 与 Frontmatter 的读写一致性。
- **唯一事实源**：[`src/core/store/WorkspaceStore.ts`](../src/core/store/WorkspaceStore.ts) 中的 `DefaultWorkspaceStore` 与 [`MutationQueue.ts`](../src/core/store/MutationQueue.ts)
- **核心运行路径与状态流转**：所有异步变更经由同一 `MutationQueue` 串行排队，消除并发 `read -> modify -> write` 覆盖；原始导入文件（`materials/<id>/files/*`）100% 只读。
- **失败与兼容语义**：Fail-closed 路径穿越与符号链接拦截；列表扫描时自动隔离单个损坏的 Markdown 文件。
- **验证命令**：`node --experimental-strip-types --test tests/store.test.ts`

### 3. 去 Session 化注意力引擎（`AttentionEngine`）

- **职责与边界**：计算首页罗盘（`compass()`）、秒存高亮与笔记（`captureSelection()`），并通过持久化队列调度后台向导异步任务。
- **唯一事实源**：[`src/core/engine/AttentionEngine.ts`](../src/core/engine/AttentionEngine.ts) 中的 `DefaultAttentionEngine`
- **核心运行路径与状态流转**：前台操作零阻塞落盘并将副作用写入 `_cache/effects.json`，按 `(kind, key)` 自动合并去重（同一 `key` 执行期间新到达的变更保留为下一拍待处理项）。
- **失败与兼容语义**：向导离线或未配置时 100% 降级为纯本地账本模式。
- **验证命令**：`node --experimental-strip-types --test tests/engine.test.ts`

### 4. 书卷舞台与行间双语（`stage-reader` & `dojo-interline`）

- **职责与边界**：`stage-reader` 负责 EPUB/PDF/CBZ/Markdown 安全净化与多栏分页；`dojo-interline` 负责外文段落哈希、滑动窗口静默预热与双语 HTML 嵌入。
- **唯一事实源**：[`src/plugins/stage-reader/epub.ts`](../src/plugins/stage-reader/epub.ts)、[`pagination.ts`](../src/plugins/stage-reader/pagination.ts) 与 [`src/plugins/dojo-interline/coordinator.ts`](../src/plugins/dojo-interline/coordinator.ts) 中的 `InterlinePreparationCoordinator`
- **核心运行路径与状态流转**：
  - EPUB 净化剥离原书中的 `pith-*` 保留类名前缀，通过 `data-epub-chapter` 与 `resolveEpubTarget` 精确解析同章/跨章内部链接；
  - `computePagination` 按阅读容器实时宽度约束 `1 / 2 / 3` 栏黄金版心并维持 `columns * (columnWidthPx + columnGapPx) === viewportWidth`；
  - `InterlinePreparationCoordinator` 按 `planNeighborhoodOrder`（`activeUnit -> neighborhood -> remaining`）调度翻译并持久化至 `_cache/interline/`；快速翻页时不中断在途（in-flight）批次，下一拍立即提权新活动章节。
- **验证命令**：`node --experimental-strip-types --test tests/dojo-interline.test.ts tests/wave13-pagination-browser.test.ts`

### 5. 标准 ACP 向导与按需语音网关（`guide-acp` & `speech-service`）

- **职责与边界**：`guide-acp` 通过标准 JSON-RPC stdio 协议驱动本机 ACP Agent；`speech-service` 与 `NodeManagedSpeechRuntime` 提供 OpenAI 兼容的 TTS/ASR 语音能力。
- **唯一事实源**：[`src/plugins/guide-acp/acpSession.ts`](../src/plugins/guide-acp/acpSession.ts)、[`src/plugins/speech-service/neuralSpeech.ts`](../src/plugins/speech-service/neuralSpeech.ts) 与 [`src/shells/speechRuntime.ts`](../src/shells/speechRuntime.ts)
- **核心运行路径与状态流转**：
  - ACP 会话通过 `initialize` + `session/new` 动态获取 Agent 暴露的 `configOptions`（模型树与推理强度），并通过 `session/set_config_option` 切换，不读取任何特定 Agent 的私有配置文件；
  - 本机语音网关将原生 `sherpa-onnx` 运行时与多语种模型（`Kokoro-82M v1.1-zh int8` + `SenseVoice int8`）安装在 Vault 外的系统应用目录，在 `local` 模式下按需拉起回环服务并在空闲 180 秒后自动退出释放内存。
- **验证命令**：`node --experimental-strip-types --test tests/track1-guide-providers.test.ts tests/task15-speech-runtime.test.ts`

## 数据与状态所有权

| 路径/存储 | 语义 | 唯一写入所有者 | 可否删除重建 |
| :--- | :--- | :--- | :--- |
| `<workspace>/ME.md` | 学习者个人认知基座画像 | `DefaultWorkspaceStore` | 否 |
| `<workspace>/topics/topic-<id>/topic.md` | 课题元数据与笔记/高亮/实训账本 | `DefaultWorkspaceStore` | 否 |
| `<workspace>/materials/material-<id>/` | 材料元数据与只读原始文件包（`files/`） | `DefaultWorkspaceStore` | 否 |
| `<workspace>/_cache/` | 对话历史、异步队列快照与 `interline/` 双语缓存 | `AttentionEngine` / `InterlinePreparationCoordinator` / Shells | 是（删除后自动重建） |
| `~/Library/Application Support/pith/speech/` | Vault 外本机语音引擎与模型资产（或 `PITH_SPEECH_HOME`） | `NodeManagedSpeechRuntime` | 是（通过设置面板重新安装） |

## 关键架构决策（已落地现状）

### 1. 直接重构原函数，严禁重赋值包装链与源码字符串 VM 测试
- **当前决定**：修改宿主或插件函数时直接编辑单一函数定义；测试直接导入真实模块或驱动真实浏览器/客户端 DOM。
- **淘汰的替代方案**：
  - **为什么不用 `const fnBase = fn; fn = ...` 包装链**：多层重赋值会让旧死代码残留，导致单测测旧分支而生产跑外层补丁。
  - **为什么不用 `readFile("src/...") + vm.runInContext`**：按行切源码塞入 VM 会反向绑架代码排版，且无法暴露真实 DOM 与事件传播缺陷。
- **守卫门禁**：[`tests/boundaries.test.ts`](../tests/boundaries.test.ts) 中的 `source does not retain Base aliases for function wrappers` 与 `tests do not execute extracted source in a VM`。

### 2. 标准 ACP 协议发现与 Vault 外原生语音守护进程
- **当前决定**：向导模型列表 100% 通过 ACP `session/new` 的 `configOptions` 与 `session/set_config_option` 交互；本机语音采用零 Python 依赖的 `sherpa-onnx` 原生运行时 + `Kokoro-82M v1.1-zh` / `SenseVoice` 按需守护进程。
- **淘汰的替代方案**：
  - **为什么不解析 `~/.dsh/` 私有 YAML**：破坏宿主无关性，无法推广到 `claude-agent-acp` 与 `codex-acp`。
  - **为什么不用系统 `speechSynthesis` 或 `python3 -m venv` + `pip`**：系统内置 TTS 机械劣质，而运行时调用 `pip` 依赖宿主机 Python 环境且易因网络/编译失败崩溃。
- **守卫门禁**：[`tests/boundaries.test.ts`](../tests/boundaries.test.ts) 中的 `managed speech uses native multilingual models and ACP never reads dsh private configuration` 与 `Zero OS-TTS & External Repo Coupling`。
