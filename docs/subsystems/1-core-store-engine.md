# 子系统 1：领域内核与工作区账本（`src/core/`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[2-stages.md](2-stages.md) · [3-dojos.md](3-dojos.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 职责与边界

[`src/core/`](../../src/core/) 是 Pith 的零依赖心脏——它不认识 Obsidian、不认识 Node.js、也不认识浏览器 DOM。所有的领域实体（[`types.ts`](../../src/core/types.ts)）、宿主窄边界（[`HostPort`](../../src/core/host.ts)）、插件接缝与 `Stage` / `Toolkit` 协议契约（[`seams.ts`](../../src/core/seams.ts)）、纯文本 Markdown 读写协议（[`store/`](../../src/core/store/)）、课题看板与注意力调度引擎（[`engine/`](../../src/core/engine/)）以及插件挂载生命周期（[`pluginrt/`](../../src/core/pluginrt/)）都在此定义。

---

## 2. 四大领域实体与表层解耦（Core Domain vs. Surface Persona）

### 2.1 四大核心实体拓扑

```text
           ┌──────────────────────────────────────────┐
           │             Profile (ME.md)              │
           │  已知领域 · 擅长类比 · 学习偏好 · 常见卡点  │
           └────────────────────┬─────────────────────┘
                                │ 因人施教拆课 & 毕业反哺
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                           Topic (课题)                             │
│  - id, title, target (唯一核心求知目标)                            │
│  - status: "exploring" (探索中) | "settled" (已内化沉淀)            │
│  - nextAction: 下一步 15 分钟内可执行的具体微动作                  │
│  - toolkits: 启发式默认或向导动态 CRUD 的 Toolkit ID 列表          │
└──────────┬──────────────────────────────────────────────┬──────────┘
           │ 1:1 绑定可观测载体 (或按需自动创建讲义包)     │ 1:N 沉淀轨迹
           ▼                                              ▼
┌─────────────────────────────────┐        ┌─────────────────────────────────┐
│       Material (材料包)         │        │      Note (笔记/高亮/诊断)      │
│  - kind: book|article|media|repo│        │  - kind: highlight|note|practice│
│  - files: 任意原始文件或递进讲义 │◄───────│  - anchor: { file, locator,     │
│  - locator: 内在阅读位置坐标    │ 精确回跳│              quote }            │
│  - externalPath / commitSha     │        │  - body: 用户原话或实训误差诊断 │
└─────────────────────────────────┘        │  - guideRemark: 向导简短批注    │
                                           └─────────────────────────────────┘
```

### 2.2 内核中性词与表层皮肤字典（[`DEFAULT_PERSONAS`](../../src/core/types.ts)）

内核代码、存储协议与工具接口固定使用中性领域词；面向用户的界面文案通过 [`SurfacePersona`](../../src/core/types.ts) 解耦，严禁在源码中残留已废弃的历史词：

| 概念维度 | 内核固定标识 | `sanctuary` 皮肤文案 | `studio` 皮肤文案 | 严禁出现的历史废弃词 |
| :--- | :--- | :--- | :--- | :--- |
| **工作区根目录** | `Workspace` | 花园 | 工作区 | `Sylva`, `Garden/`, `.gg-*` |
| **个人认知基座** | `Profile` (`ME.md`) | 学习者画像 (`ME.md`) | 个人基座 (`ME.md`) | - |
| **探索课题单元** | `Topic` (`topics/<id>/topic.md`) | 课题 | 课题 | `Seed`, `Thread` |
| **课题状态** | `"exploring" \| "settled"` | 探索中 / 已沉淀 | 进行中 / 已归档 | - |
| **可观测材料包** | `Material` (`materials/<id>/`) | 材料 | 材料 | `Source`, `SourceRecord` |
| **思考与实训记录** | `TopicNote` & `SelectionAnchor` | 笔记与高亮 | 笔记与锚点 | `Bloom`, `Gap`, `Attempt` |
| **AI 认知管家** | `Guide` (`pith-choices`) | 园丁 | 向导 | `GardenerService` |
| **学习脚手架工具** | `Toolkit` (`DojoToolkitDescriptor` / `toolkits`) | 实训工坊 | 训练工具 | `Echo`, `EchoModal` |

---

## 3. 物理磁盘布局与 Markdown 账本协议（`WorkspaceStore`）

[`DefaultWorkspaceStore`](../../src/core/store/WorkspaceStore.ts) 是工作区持久化文件的**唯一写入所有者**。所有修改操作经由 [`MutationQueue.forStorage`](../../src/core/store/MutationQueue.ts) 按底层存储身份串行排队，杜绝并发 `read -> modify -> write` 互相覆盖。

### 3.1 工作区目录树

```text
<workspace>/                            # 独立 Web 壳为指定目录，Obsidian 壳默认为 Vault 下 Pith/
├── ME.md                               # 学习者个人认知基座权重（已知领域、擅长类比、认知盲区）
├── topics/
│   └── topic-<id>/
│       └── topic.md                    # 课题元数据 + toolkits 列表 + 高亮/笔记/实训诊断账本
├── materials/
│   └── material-<id>/
│       ├── material.md                 # 材料元数据（含可选 externalPath/commitSha）、SHA-256 清单与 locator
│       └── files/
│           ├── 00-课程大纲.md          # 向导按课题拆解生成的递进课程讲义（标记 generated: true）
│           └── <name>                  # 100% 只读的原始导入文件（书籍、源码、音视频、任意附件）
└── _cache/                             # 可随时删除重建的衍生缓存
    ├── effects.json                    # 后台异步任务队列快照
    ├── conversations/<topic-id>.json   # 按课题持久化的向导对话与选项胶囊
    └── interline/<mat>/<file>.<lang>.unit-<n>.json  # 行间双语段落译文缓存
```

### 3.2 `topic.md` 与 `material.md` 持久化格式

- **`topic.md`**：Frontmatter 固定 `type: pith-topic`；正文每条记录以 `## [highlight|note|practice] <timestamp>` 开头，并用 `<!-- pith-note:v1 -->` 至 `<!-- pith-note:end -->` 定界，确保多行原文引用（`quote`）、思考正文（`body`）与向导评注（`guideRemark`）无损往返：

```markdown
---
type: pith-topic
id: topic-20261109-dsh-arch
title: 深入理解 DSH 架构与插件模型
target: 能独立讲清四层单向拓扑并动手编写一个最小插件
status: exploring
material: "[[materials/material-20261109-dsh-arch/material]]"
nextAction: 阅读《01-核心拓扑.md》并用费曼工具复述 HostPort 边界
toolkits:
  - feynman
createdAt: "2026-11-09T10:00:00.000Z"
updatedAt: "2026-11-09T10:15:00.000Z"
---

## [note] 2026-11-09T10:15:00.000Z
<!-- pith-note:v1 -->
- id: "note-1"
- file: "01-核心拓扑.md"
- locator: "text:line:12"

<!-- pith-note:quote -->
> 顺畅的讲解极易制造流畅性错觉。

<!-- pith-note:body -->
看别人健身不长肌肉，必须自己先做一次前向生成（Rollout）。

<!-- pith-note:remark -->
> [guide] 类比准确，下一步可尝试脱稿复述该机制的边界条件。

<!-- pith-note:end -->
```

- **`material.md`**：Frontmatter 固定 `type: pith-material`，记录 `id`、`title`、`kind`（`book | article | media | discussion | repo`）、`createdAt`、可选本地代码仓绑定（`externalPath` / `commitSha`）以及 `files` 数组（含 `name`、`mimeType`、`bytes`、64 位十六进制 `sha256`、可选 `generated: true`、当前阅读位置 `locator` 与 `lastActiveAt`）：

```markdown
---
type: pith-material
id: material-20261109-dsh-arch
title: DSH 源码仓库
kind: repo
externalPath: "/Users/me/Projects/dsh"
commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
createdAt: "2026-11-09T10:00:00.000Z"
files:
  - name: 00-课程大纲.md
    mimeType: text/markdown
    bytes: 2048
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    generated: true
    locator: "text:line:0"
    lastActiveAt: "2026-11-09T10:15:00.000Z"
---
```

### 3.3 任意材料导入、讲义自动挂载与安全语义（Fail-Closed）

- **无材料课题自动创建讲义包**：当用户以一句话意图（如“我想学 magpie”）新建无初始文件的课题，或绑定了 `files: []` 的代码仓库课题时，向导调用讲义写入工具（`pith_write_lesson`）若发现该 Topic 尚未关联 `materialId`，Store 支持自动为该 Topic 创建并绑定一个专属 `Material` 容器，将《`00-课程大纲.md`》与《`01-xxx.md`》写入其中并立即在左侧 Stage 呈现。
- **路径穿越拦截与原始文件只读保护**：所有 `topicId`、`materialId` 与 `fileName` 均禁止包含 `/`、`\`、`\0`、`.` 或 `..`；[`writeGeneratedFile`](../../src/core/store/WorkspaceStore.ts) 仅允许写入带 `generated: true` 标记的 `.md` 衍生讲义，严禁覆盖 `files/` 下任何原始导入文件。
- **坏文件隔离**：[`listTopics`](../../src/core/store/WorkspaceStore.ts) 与 [`listMaterials`](../../src/core/store/WorkspaceStore.ts) 扫描目录时，遇到单个损坏或格式非法的 Markdown 文件自动跳过，不阻断整个工作区加载。

---

## 4. 去 Session 化注意力引擎（`AttentionEngine`）

Pith 拒绝通用聊天软件“满屏历史聊天窗口”的心智负担。[`DefaultAttentionEngine`](../../src/core/engine/AttentionEngine.ts) 将所有交互收束到课题（`Topic`）本身：

1. **课题看板与今日焦点（[`compass()`](../../src/core/engine/AttentionEngine.ts)）**：聚合当前所有 `exploring` 与 `settled` 课题，自动挑选第一个带有明确 15 分钟微动作（`nextAction`）的活跃课题作为今日焦点推荐（`focusRecommendation`）。
2. **零阻塞选区捕获（[`captureSelection()`](../../src/core/engine/AttentionEngine.ts)）**：用户在阅读舞台划高亮、记笔记或保存实训结果时，前台立即落盘至 `topic.md`，同时在后台合并入队一条 `(kind: "prepare-next-action", key: topicId)` 副作用任务。
3. **同键合并持久化队列（`_cache/effects.json`）**：
   - [`enqueueEffect(kind, key, payload)`](../../src/core/engine/AttentionEngine.ts) 对处于 `pending` 状态的同 `(kind, key)` 任务原地更新 `payload`，避免连续划线触发多次冗余 LLM 请求；
   - 进程重启后首次调用 [`processDueEffects()`](../../src/core/engine/AttentionEngine.ts) 自动将崩溃前残留的 `running` 项恢复为 `pending`。
4. **向导对话与离线降级（[`sendMessage()`](../../src/core/engine/AttentionEngine.ts)）**：未配置或未连接向导 Agent 时，用户立项、导入资料、阅读、提问与记笔记依然 100% 落盘可用。

---

## 5. 插件运行时（`PluginRuntime`）

[`PluginRuntime.compose()`](../../src/core/pluginrt/runtime.ts) 按四层优先级决定每个插件的开启状态：

```text
Layer 1: default（默认全开）
  ↓
Layer 2: preset（"essentials" 预设下关闭 essential: false 的扩展插件）
  ↓
Layer 3: user（显式插件配置）
  ↓
Layer 4: inUse 守卫 + 传递依赖提权（Transitive Requirement Propagation）
```

- **存档保活**：只要工作区中已有课题或材料正在使用某插件（`manifest.inUse() > 0`，或者 `inUse()` 抛错处于未知状态），该插件强制保持开启（`source: "in-use"`），并自动将其 `requires` 依赖链上的底层服务提供者一并拉起。
- **栈式服务表与热重挂**：[`reconcile()`](../../src/core/pluginrt/runtime.ts) 比对当前激活配置与新配置——当某插件停用或配置变更时，先按激活逆序卸载该插件及其下游依赖方，再按拓扑顺序重新挂载。

---

## 6. 验证命令

```bash
node --experimental-strip-types --test tests/pluginrt.test.ts tests/store.test.ts tests/engine.test.ts
```
