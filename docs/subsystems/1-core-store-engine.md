# 子系统 1：领域内核与工作区账本（`src/core/`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[2-stages.md](2-stages.md) · [3-dojos.md](3-dojos.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 职责与边界

`src/core/` 是 Pith 的零依赖心脏——它不认识 Obsidian、不认识 Node.js、也不认识浏览器 DOM。所有的领域实体、纯文本 Markdown 读写协议、注意力罗盘调度以及插件挂载生命周期都在这里完成。

```text
src/core/
├── types.ts              # 领域实体：LearnerProfile / Topic / Material / TopicNote / SelectionAnchor
├── host.ts               # 宿主窄边界接口：HostPort（storage / http / secrets / sanitizer / process / speechRuntime）
├── seams.ts              # 插件能力接缝契约：Stage / Dojo / Speech / Guide / Interline 服务接口
├── pluginrt/             # 插件运行时与视图槽错误隔离内核
│   ├── runtime.ts        # PluginRuntime（4 层配置合成、拓扑挂载、逆序卸载、inUse 传递保活）
│   ├── kernel.ts         # ViewKernel（UI 槽位 mount/render 错误边界与 retry 恢复）
│   └── schema.ts         # 插件设置 Schema 编译与默认值合成
├── store/                # 纯文本工作区唯一写入通道
│   ├── contract.ts       # WorkspaceStore 接口定义
│   ├── WorkspaceStore.ts # DefaultWorkspaceStore（ME.md / topics / materials 序列化与校验）
│   ├── MutationQueue.ts  # 同一存储实例的串行写队列
│   └── frontmatter.ts    # YAML Frontmatter 解析与生成
└── engine/               # 去 Session 化注意力引擎与持久化副作用队列
    ├── contract.ts       # AttentionEngine 与 EffectRecord 接口定义
    └── AttentionEngine.ts# DefaultAttentionEngine（compass / captureSelection / sendMessage / effects）
```

---

## 2. 四大领域实体与表层解耦（Core Domain vs. Surface Persona）

### 2.1 四大核心实体拓扑

```text
           ┌──────────────────────────────────────────┐
           │             Profile (ME.md)              │
           │  已知领域 · 擅长类比 · 学习偏好 · 常见卡点  │
           └────────────────────┬─────────────────────┘
                                │ 因人施教 & 毕业反哺
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                           Topic (课题)                             │
│  - id, title, target (唯一核心求知目标)                            │
│  - status: "exploring" (探索中) | "settled" (已内化沉淀)            │
│  - nextAction: 下一步 15 分钟内可执行的具体微动作                  │
│  - toolkits: 按需挂载的认知工具 ID 列表 (如 ["interline","feynman"])│
└──────────┬──────────────────────────────────────────────┬──────────┘
           │ 1:1 绑定可观测载体                           │ 1:N 沉淀轨迹
           ▼                                              ▼
┌─────────────────────────────────┐        ┌─────────────────────────────────┐
│       Material (材料包)         │        │      Note (笔记/高亮/诊断)      │
│  - kind: book|article|media|repo│        │  - kind: highlight|note|practice│
│  - files: 只读原文件或生成讲义  │◄───────│  - anchor: { file, locator,     │
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
| **AI 引导协作者** | `Guide` (`pith-choices`) | 园丁 | 向导 | `GardenerService` |
| **按需认知工具** | `DojoToolkit` (`toolkits`) | 实训工坊 | 训练场 | `Echo`, `EchoModal` |

---

## 3. 物理磁盘布局与 Markdown 账本协议（`WorkspaceStore`）

[`DefaultWorkspaceStore`](../../src/core/store/WorkspaceStore.ts) 是工作区持久化文件的**唯一写入所有者**。所有修改操作经由 [`MutationQueue.forStorage`](../../src/core/store/MutationQueue.ts) 按底层存储身份串行排队，杜绝并发 `read -> modify -> write` 互相覆盖。

### 3.1 工作区目录树

```text
<workspace>/                            # 独立 Web 壳为指定目录，Obsidian 壳默认为 Vault 下 Pith/
├── ME.md                               # 学习者个人认知基座权重（已知领域、擅长类比、认知盲区）
├── topics/
│   └── topic-<id>/
│       └── topic.md                    # 课题元数据 + 高亮/笔记/实训诊断账本
├── materials/
│   └── material-<id>/
│       ├── material.md                 # 材料元数据、文件 SHA-256 清单与内在阅读坐标 locator
│       └── files/
│           └── <name>                  # 100% 只读的原始导入文件，或向导生成的 .md 讲义
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
id: topic-attention
title: 搞懂生成式学习与人类后训练
target: 能合上书讲清只看摘要不更新大脑参数的原因
status: exploring
material: "[[materials/material-learning/material]]"
nextAction: 精读第 2 章并使用费曼道场完成一次盲产复述
toolkits:
  - feynman
createdAt: "2026-11-05T10:00:00.000Z"
updatedAt: "2026-11-05T10:15:00.000Z"
---

## [note] 2026-11-05T10:15:00.000Z
<!-- pith-note:v1 -->
- id: "note-1"
- file: "book.epub"
- locator: "epub:chapter:1;block:3"

<!-- pith-note:quote -->
> 顺畅的讲解极易制造流畅性错觉。

<!-- pith-note:body -->
看别人健身不长肌肉，必须自己先做一次前向生成（Rollout）。

<!-- pith-note:remark -->
> [guide] 类比准确，下一步可尝试脱稿复述该机制的边界条件。

<!-- pith-note:end -->
```

- **`material.md`**：Frontmatter 固定 `type: pith-material`，记录 `id`、`title`、`kind`（`book | article | media | discussion | repo`）、`createdAt`、可选代码仓绑定（`externalPath` / `commitSha`）以及 `files` 数组（含 `name`、`mimeType`、`bytes`、64 位十六进制 `sha256`、当前阅读位置 `locator` 与 `lastActiveAt`）：

```markdown
---
type: pith-material
id: material-learning
title: 学习科学导论
kind: book
createdAt: "2026-11-05T10:00:00.000Z"
files:
  - name: book.epub
    mimeType: application/epub+zip
    bytes: 412908
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    locator: "epub:chapter:1;block:3"
    lastActiveAt: "2026-11-05T10:15:00.000Z"
---
```

### 3.3 安全与容错语义（Fail-Closed）

- **路径穿越拦截**：所有 `topicId`、`materialId` 与 `fileName` 均禁止包含 `/`、`\`、`\0`、`.` 或 `..`；[`writeGeneratedFile`](../../src/core/store/WorkspaceStore.ts) 仅允许写入 `.md / .markdown` 衍生讲义，且严禁覆盖 `files/` 下已有的原始导入文件。
- **坏文件隔离**：[`listTopics`](../../src/core/store/WorkspaceStore.ts) 与 [`listMaterials`](../../src/core/store/WorkspaceStore.ts) 扫描目录时，遇到单个损坏或格式非法的 Markdown 文件自动跳过，不阻断整个工作区加载。

---

## 4. 去 Session 化注意力引擎（`AttentionEngine`）

Pith 拒绝通用聊天软件“满屏历史聊天窗口”的心智负担。[`DefaultAttentionEngine`](../../src/core/engine/AttentionEngine.ts) 将所有交互收束到课题（`Topic`）本身：

1. **注意力罗盘（[`compass()`](../../src/core/engine/AttentionEngine.ts)）**：聚合当前所有 `exploring` 与 `settled` 课题，自动挑选第一个带有明确 15 分钟微动作（`nextAction`）的活跃课题作为今日焦点推荐（`focusRecommendation`）。
2. **零阻塞选区捕获（[`captureSelection()`](../../src/core/engine/AttentionEngine.ts)）**：用户在阅读舞台划高亮、记笔记或保存实训结果时，前台立即落盘至 `topic.md`，同时在后台合并入队一条 `(kind: "prepare-next-action", key: topicId)` 副作用任务。
3. **同键合并持久化队列（`_cache/effects.json`）**：
   - [`enqueueEffect(kind, key, payload)`](../../src/core/engine/AttentionEngine.ts) 对处于 `pending` 状态的同 `(kind, key)` 任务原地更新 `payload`，避免连续划线触发多次冗余 LLM 请求；
   - 若同一 `(kind, key)` 正在 `running` 执行中，新到达的变更会保留为下一拍 `pending` 项；进程重启后首次调用 [`processDueEffects()`](../../src/core/engine/AttentionEngine.ts) 会自动将崩溃前残留的 `running` 项恢复为 `pending`。
4. **向导对话与离线降级（[`sendMessage()`](../../src/core/engine/AttentionEngine.ts)）**：未配置或未连接向导 Agent 时，用户提问与笔记依然落盘成功，系统 100% 降级为纯本地训练账本。

---

## 5. 插件运行时与视图内核（`PluginRuntime` & `ViewKernel`）

### 5.1 四层配置合成与 `inUse` 传递保活

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

- **存档保活**：只要工作区中已有课题或材料正在使用某插件（`manifest.inUse() > 0`，或者 `inUse()` 抛错处于未知状态），该插件强制保持开启（`source: "in-use"`），并自动将其 `requires` 依赖链上的底层服务提供者一并拉起，确保已存课题永不因预设切换而卡死在 `pending`。
- **栈式服务表与热重挂**：[`reconcile()`](../../src/core/pluginrt/runtime.ts) 比对当前激活配置与新配置——当某插件停用或配置变更时，先按激活逆序（`newest first`）卸载该插件及其下游依赖方，再按拓扑顺序重新挂载。单个插件 `apply(ctx)` 抛错时立即调用 [`ctx.undo()`](../../src/core/pluginrt/runtime.ts) 逆序回滚半途注册项并标记为 `failed`，绝不传染其他插件。

### 5.2 视图槽位错误隔离（[`ViewKernel`](../../src/core/pluginrt/kernel.ts)）

管理 `stage`、`dojo`、`guide`、`toolbar`、`nav.page` 五类 UI 槽位。单个槽位的 `mount` 或 `render` 抛错时，仅将该槽位记为 `broken` 并暴露 `retry()` 恢复句柄，主界面其余部分照常运行。

---

## 6. 验证命令

```bash
node --experimental-strip-types --test tests/pluginrt.test.ts tests/store.test.ts tests/engine.test.ts
```
