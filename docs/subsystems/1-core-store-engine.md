# 子系统 1：领域内核与工作区账本（`src/core/`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[2-stages.md](2-stages.md) · [3-toolkits.md](3-toolkits.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 职责与边界

[`src/core/`](../../src/core/) 不认识 Obsidian、Node.js 和浏览器 DOM。领域实体（[`types.ts`](../../src/core/types.ts)）、宿主窄边界（[`HostPort`](../../src/core/host.ts)）、插件接缝（[`seams.ts`](../../src/core/seams.ts)）、纯文本读写协议（[`store/`](../../src/core/store/)）、注意力引擎（[`engine/`](../../src/core/engine/)）与插件运行时（[`pluginrt/`](../../src/core/pluginrt/)）都在此定义。

---

## 2. 三个实体

```text
┌──────────────────────────────┐
│ Profile (ME.md) · 永久        │  你写的部分 + 向导的观察条目
└──────────────▲───────────────┘
               │ 结题时写入观察条目
┌──────────────┴───────────────────────────────────────────────┐
│ Topic · 临时 (exploring → settled；exploring ⇄ shelved)       │
│  target · nextAction · toolkits                               │
│  lessons/          向导为本课题写的大纲与讲义                 │
│  conversation.json 本课题唯一的一条对话                       │
│  notes             高亮 / 笔记 / 实训记录                     │
└──────────────┬───────────────────────────────────────────────┘
               │ 引用 0..N 份（只引用，不拥有）
┌──────────────▼───────────────────────────────────────────────┐
│ Material · 永久                                               │
│  files/  只读原始文件，或 externalPath + commitSha            │
│  每个文件的阅读位置 · aids（阅读辅助）                        │
│  notes   课题之外记下的高亮 / 笔记                            │
└──────────────────────────────────────────────────────────────┘
```

不变量：

1. **材料不依赖课题。** 一份材料可以被零个或多个课题引用。材料库是全部材料的列表，不是独立实体。
2. **材料导入后不再变化。** 文件集合固定；向导生成的内容一律写进课题的 `lessons/`，不写进材料。
3. **课题只能由向导创建和沉淀。** 创建只经向导工具 `pith_create_topic`，沉淀只经 `pith_settle_topic`（[4-guide-speech-shells.md](4-guide-speech-shells.md)）。搁置与恢复由用户直接操作。守卫单测锁定这两个工具之外没有创建课题或把课题置为 `settled` 的调用点。
4. **课题只增加材料引用，不移除。** 笔记锚点指向材料，移除引用会让锚点失效。
5. **锚点自带来源。** 每个锚点指明文件属于哪份材料，或属于本课题的讲义。
6. **画像分区。** 程序只改 `ME.md` 里「向导的观察」一节，其余内容原样保留。
7. **Pith 不删除任何课题或材料。** 工作区是普通文件，可以在文件管理器里删除；删除后悬空的引用由看板的「无法读取」分区报告，不自动修复。

内核代码、存储协议与工具接口固定使用中性领域词，界面文案由 [`SurfacePersona`](../../src/core/types.ts) 决定：

| 概念 | 内核标识 | `sanctuary` 皮肤 | `studio` 皮肤 | 禁止出现的历史词 |
| :--- | :--- | :--- | :--- | :--- |
| 工作区根目录 | `Workspace` | 花园 | 工作区 | `Sylva`、`Garden/`、`.gg-*` |
| 画像 | `Profile`（`ME.md`） | 学习者画像 | 个人基座 | - |
| 课题 | `Topic` | 课题 | 课题 | `Seed`、`Thread` |
| 课题状态 | `"exploring" \| "shelved" \| "settled"` | 探索中 / 搁置 / 已沉淀 | 进行中 / 搁置 / 已归档 | - |
| 材料 | `Material` | 材料 | 材料 | `Source`、`SourceRecord` |
| 记录 | `Note` & `SelectionAnchor` | 笔记与高亮 | 笔记与锚点 | `Bloom`、`Gap`、`Attempt` |
| 向导 | `Guide` | 园丁 | 向导 | `GardenerService` |
| 工具 | `Toolkit`（`ToolkitDescriptor`） | 实训工坊 | 训练工具 | `Dojo`、`dojo-*`、`Echo`、`EchoModal` |

---

## 3. 磁盘布局与账本格式（`WorkspaceStore`）

[`DefaultWorkspaceStore`](../../src/core/store/WorkspaceStore.ts) 是工作区持久化文件的唯一写入者。所有修改经 [`MutationQueue.forStorage`](../../src/core/store/MutationQueue.ts) 按底层存储身份串行排队。

### 3.1 目录树

```text
<workspace>/                        # 独立 Web 壳为指定目录，Obsidian 壳默认为 Vault 下 Pith/
├── ME.md                           # 画像
├── history/
│   └── ME-<timestamp>.md           # 程序每次改写 ME.md 之前的上一版
├── materials/
│   └── material-<id>/
│       ├── material.md             # 元数据、文件清单与阅读位置、aids、材料级高亮/笔记
│       └── files/<name>            # 只读原始文件
├── topics/
│   └── topic-<id>/
│       ├── topic.md                # 元数据、材料引用、讲义清单、高亮/笔记/实训记录
│       ├── lessons/
│       │   ├── 00-课程大纲.md
│       │   └── 01-<name>.md
│       └── conversation.json       # 本课题的对话回合
└── _cache/                         # 可删除，删除后自动重建
    ├── effects.json                # 后台任务队列
    ├── interline/<material>/<file>.<lang>.unit-<n>.json
    ├── feynman/<source>/<file>.<passage-sha>.json   # 复述要点清单
    └── covers/<material>.<ext>     # 看板封面缩略图
```

对话属于课题，不可重建，所以在课题目录里，不在 `_cache/`。

### 3.2 `topic.md`

```markdown
---
type: pith-topic
id: topic-20261112-agent-kernel
title: agent 框架怎么划分内核与插件
target: 能对比四个框架的内核边界，并说出各自把什么留在内核里
status: exploring
materials:
  - "[[materials/material-dsh/material]]"
  - "[[materials/material-magpie/material]]"
nextAction: 读《01-内核边界.md》，用费曼复述 dsh 的服务注入
toolkits:
  - feynman
lessons:
  - name: 00-课程大纲.md
    locator: "text:line:0"
    lastActiveAt: "2026-11-12T10:15:00.000Z"
  - name: 01-内核边界.md
createdAt: "2026-11-12T10:00:00.000Z"
updatedAt: "2026-11-12T10:15:00.000Z"
---

## [note] 2026-11-12T10:15:00.000Z
<!-- pith-note:v1 -->
- id: "note-1"
- material: "material-dsh"
- file: "packages/core/README.md"
- locator: "text:line:12"

<!-- pith-note:quote -->
> 每个插件只通过 Context 取得服务。

<!-- pith-note:body -->
和 Pith 的 HostPort 是同一种做法：能力从外面注入，内核不去找。

<!-- pith-note:end -->
```

- `target` 必填且非空。`materials`、`toolkits`、`lessons` 三个列表必须出现，可以为空；`toolkits` 只含训练工具。
- 记录以 `## [highlight|note|practice] <timestamp>` 开头，以 `<!-- pith-note:v1 -->` 至 `<!-- pith-note:end -->` 定界。带锚点的记录有三行：来源（`- material: "<id>"` 或 `- lesson: true`，二者必居其一）、`- file` 与 `- locator`；不带锚点的记录三行都没有。
- 实训记录可带 `<!-- pith-note:result -->` 块，内容是一行 JSON：训练工具的结构化结果（费曼复述的要点清单与逐条状态见 [3-toolkits.md](3-toolkits.md)）。
- 向导批注放在 `<!-- pith-note:remark -->` 块。

### 3.3 `material.md`

```markdown
---
type: pith-material
id: material-dsh
title: DeepSeek Harness
kind: repo
externalPath: "/Users/me/Projects/dsh"
commitSha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
aids: []
createdAt: "2026-11-12T09:00:00.000Z"
files: []
---
```

- `kind` 为 `book | article | media | discussion | repo`。`aids` 与 `files` 两个列表必须出现，可以为空。`files` 每项含 `name`、`mimeType`、`bytes`、64 位十六进制 `sha256`、可选的 `locator` 与 `lastActiveAt`。
- `aids` 是在这份材料上开启的阅读辅助 ID 列表（目前只有 `interline`）。导入时按材料语言预置，见 [3-toolkits.md](3-toolkits.md)。
- 正文是材料级记录，格式与 `topic.md` 的记录相同，只允许 `highlight` 与 `note`，来源行固定指向材料自身。

### 3.4 `ME.md`

```markdown
# 学习者画像（ME.md）

（你写的任何内容，程序不改动）

## 向导的观察
<!-- pith-observations:v1 -->
- id: "obs-7f3a" · 2026-11-12 · topic-20261112-agent-kernel · note-4
  熟悉依赖注入，可以用它类比各框架的服务边界。
<!-- pith-observations:end -->
```

- 程序只读写两个标记之间的内容。标记不存在时在文件末尾追加这一节；标记残缺或重复时拒绝写入并报告原因。
- 每条观察占两行。第一行是 `- id: "<id>" · <日期> · <课题 ID>`，有证据笔记时再接 ` · <笔记 ID>`；第二行缩进两个空格，是观察正文。正文是单行文本，不超过 500 字，写入前把换行折成空格。日期取写入时刻 ISO 时间戳的日期部分（UTC）。
- 每次写入前，把当前 `ME.md` 复制到 `history/ME-<timestamp>.md`，`<timestamp>` 形如 `20261112T101500123Z`。复制失败则不写入。

### 3.5 `conversation.json`

一个 JSON 数组，元素是回合（`GuideTurn`，见第 4 节），按时间先后排列。回合开始时以 `running` 状态落盘，此时已含用户消息；结算时改写为终态。加载时仍是 `running` 而没有对应的运行中请求的回合，按 `stopped` 显示，原因为进程中断。

工具步骤只保存工具名、输入的有界预览与结果摘要，不保存完整输入（例如讲义全文）。

### 3.6 安全语义

- **路径穿越拦截**：`topicId`、`materialId` 与文件名禁止包含 `/`、`\`、`\0`、`.` 或 `..`。
- **原始文件只读**：材料 `files/` 下的文件导入后不被任何接口改写。讲义只能写进 `topics/<id>/lessons/`，文件名以 `.md` 结尾。
- **坏文件隔离**：`listTopics` 与 `listMaterials` 省略解析失败的条目；`listUnreadable()` 逐条给出目录名、账本路径与解析器原因，目录名与账本 `id` 不一致的条目同样列出。引用了不存在材料的课题也列出。

---

## 4. 内核契约

以下是冻结的公共形状。实现按此落地，不另行扩展；需要改动时先改本节。这里没有列出的类型（`MaterialFileEntry`、`UnreadableEntry`、`EffectKind`、`EffectRecord`、`EffectHandler` 等）保持源码现状。

```ts
// src/core/types.ts
export type TopicStatus = "exploring" | "shelved" | "settled";
export type MaterialKind = "book" | "article" | "media" | "discussion" | "repo";
export type NoteKind = "highlight" | "note" | "practice";
export type IntrinsicLocator = string;

/** Where an anchored file lives: a workspace material, or the lessons of the topic that owns the note. */
export type AnchorSource =
  | { readonly kind: "material"; readonly materialId: string }
  | { readonly kind: "lesson" };

export interface SelectionAnchor {
  readonly source: AnchorSource;
  readonly file: string;
  readonly locator: IntrinsicLocator;
  readonly quote?: string;
}

export interface Note {
  readonly id: string;
  readonly kind: NoteKind;
  readonly createdAt: string;
  readonly anchor?: SelectionAnchor;
  readonly body: string;
  readonly guideRemark?: string;
  /** Structured result of a training toolkit; present on `practice` notes only. */
  readonly result?: Readonly<Record<string, unknown>>;
}

export interface LessonEntry {
  readonly name: string;
  readonly locator?: IntrinsicLocator;
  readonly lastActiveAt?: string;
}

export interface Topic {
  readonly id: string;
  readonly title: string;
  /** The question this topic settles; never empty. */
  readonly target: string;
  readonly status: TopicStatus;
  readonly materialIds: readonly string[];
  readonly nextAction?: string;
  /** Training toolkit IDs mounted on this topic. */
  readonly toolkits: readonly string[];
  readonly lessons: readonly LessonEntry[];
  readonly notes: readonly Note[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Material {
  readonly id: string;
  readonly title: string;
  readonly kind: MaterialKind;
  readonly createdAt: string;
  readonly files: readonly MaterialFileEntry[];
  readonly externalPath?: string;
  readonly commitSha?: string;
  /** Reading-aid toolkit IDs enabled on this material. */
  readonly aids: readonly string[];
  /** Highlights and notes taken outside any topic. */
  readonly notes: readonly Note[];
}

export interface ProfileObservation {
  readonly id: string;
  readonly date: string;
  readonly text: string;
  readonly topicId: string;
  readonly noteId?: string;
}

export interface LearnerProfile {
  readonly markdown: string;
  readonly observations: readonly ProfileObservation[];
}
```

```ts
// src/core/store/contract.ts
export interface WorkspaceStore {
  ensureScaffold(): Promise<void>;

  readProfile(): Promise<LearnerProfile>;
  addObservation(input: { text: string; topicId: string; noteId?: string }): Promise<ProfileObservation>;
  removeObservation(observationId: string): Promise<void>;

  listTopics(): Promise<readonly Topic[]>;
  getTopic(topicId: string): Promise<Topic | null>;
  createTopic(input: { title: string; target: string; materialIds: readonly string[]; toolkits: readonly string[]; nextAction?: string }): Promise<Topic>;
  updateTopic(topicId: string, patch: { title?: string; target?: string; status?: TopicStatus; nextAction?: string; toolkits?: readonly string[] }): Promise<Topic>;
  attachMaterial(topicId: string, materialId: string): Promise<Topic>;
  appendTopicNote(topicId: string, note: AppendNoteInput): Promise<Note>;
  writeLesson(topicId: string, fileName: string, markdown: string): Promise<Topic>;
  readLesson(topicId: string, fileName: string): Promise<string>;
  updateLessonLocator(topicId: string, fileName: string, locator: IntrinsicLocator): Promise<void>;

  listMaterials(): Promise<readonly Material[]>;
  getMaterial(materialId: string): Promise<Material | null>;
  importMaterial(input: ImportMaterialInput): Promise<Material>;
  setMaterialAids(materialId: string, aids: readonly string[]): Promise<Material>;
  appendMaterialNote(materialId: string, note: AppendNoteInput): Promise<Note>;
  updateReadingLocator(materialId: string, fileName: string, locator: IntrinsicLocator): Promise<void>;

  listUnreadable(): Promise<readonly UnreadableEntry[]>;
}

export interface AppendNoteInput {
  readonly kind: NoteKind;
  readonly body: string;
  readonly anchor?: SelectionAnchor;
  readonly guideRemark?: string;
  readonly result?: Readonly<Record<string, unknown>>;
}

export interface ImportMaterialInput {
  readonly title: string;
  readonly kind: MaterialKind;
  readonly files: readonly { readonly name: string; readonly mimeType?: string; readonly bytes: Uint8Array }[];
  readonly externalPath?: string;
  readonly commitSha?: string;
  /** Reading aids to enable from the start; the caller decides them from a text sample. */
  readonly aids?: readonly string[];
}
```

`updateTopic` 只接受 `exploring ⇄ shelved` 与 `exploring → settled` 两种状态变化，其余抛错。`appendMaterialNote` 拒绝 `practice`。原有的 `writeProfile`、`writeGeneratedFile`、`appendMaterialFiles`、`updateTopicIfUnchanged` 与 `toolkitsOrigin` 不再存在。

```ts
// src/core/engine/contract.ts
export type TurnStatus = "running" | "completed" | "failed" | "stopped";

/** A durable outcome of a tool call that the workbench can open or undo. */
export type TurnEffect =
  | { readonly kind: "topic"; readonly topicId: string }
  | { readonly kind: "lesson"; readonly fileName: string }
  | { readonly kind: "note"; readonly noteId: string }
  | { readonly kind: "material"; readonly materialId: string }
  | { readonly kind: "toolkits"; readonly toolkits: readonly string[] }
  | { readonly kind: "observation"; readonly observationId: string; readonly text: string };

export type TurnStep =
  | { readonly kind: "thought"; readonly text: string }
  | { readonly kind: "tool"; readonly callId: string; readonly name: string; readonly inputPreview: string;
      readonly status: "running" | "completed" | "failed"; readonly summary?: string; readonly effect?: TurnEffect }
  | { readonly kind: "reply"; readonly markdown: string };

export interface GuideTurn {
  readonly id: string;
  readonly status: TurnStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly user: {
    readonly text: string;
    readonly anchor?: SelectionAnchor;
    /** Guidance for this turn supplied by a toolkit; sent to the guide, kept for retry, not displayed. */
    readonly instruction?: string;
  };
  readonly steps: readonly TurnStep[];
  /** Next-step options offered by the guide in this turn. */
  readonly choices: readonly string[];
  /** Reason of a `failed` or `stopped` turn. */
  readonly error?: string;
}

export interface TurnOptions {
  /** Aborting stops the turn; steps already received stay in the turn. */
  readonly signal?: AbortSignal;
  /** Called with the whole turn each time it changes. */
  readonly onUpdate?: (turn: GuideTurn) => void;
}

export interface LibraryEntry {
  readonly material: Material;
  readonly topicIds: readonly string[];
}

export interface AttentionCompassSnapshot {
  readonly exploring: readonly Topic[];
  readonly shelved: readonly Topic[];
  readonly settled: readonly Topic[];
  readonly library: readonly LibraryEntry[];
  readonly focusRecommendation: { readonly topicId: string; readonly title: string; readonly nextAction: string } | null;
  readonly unreadable: readonly UnreadableEntry[];
  readonly pendingEffectsCount: number;
}

export interface AttentionEngine {
  compass(): Promise<AttentionCompassSnapshot>;

  /**
   * Asks the guide to turn a goal and materials into a topic. Rejects when no guide is available.
   * `previous` carries earlier intake turns in which the guide asked a question instead of creating a topic.
   */
  intake(input: { text: string; materialIds: readonly string[]; previous?: readonly GuideTurn[] }, options?: TurnOptions):
    Promise<{ readonly topic: Topic | null; readonly turn: GuideTurn }>;

  getConversation(topicId: string): Promise<readonly GuideTurn[]>;
  /** Runs one guide turn on a topic. Resolves with the settled turn; agent failures settle as `failed`, never reject. */
  runTurn(input: { topicId: string; text: string; anchor?: SelectionAnchor; instruction?: string }, options?: TurnOptions): Promise<GuideTurn>;
  /** Runs a failed or stopped turn again with the same user message, replacing that turn. */
  retryTurn(topicId: string, turnId: string, options?: TurnOptions): Promise<GuideTurn>;

  /** Records a highlight, note or practice result on a topic, or a highlight or note on a material. */
  capture(input: { owner: { topicId: string } | { materialId: string }; kind: NoteKind; body: string;
    anchor?: SelectionAnchor; result?: Readonly<Record<string, unknown>> }): Promise<Note>;

  enqueueEffect(kind: EffectKind, key: string, payload: Readonly<Record<string, unknown>>): Promise<EffectRecord>;
  listEffects(): Promise<readonly EffectRecord[]>;
  registerEffectHandler(kind: EffectKind, handler: EffectHandler): () => void;
  processDueEffects(): Promise<number>;
}

/** Implemented by the guide plugin; the engine owns persistence of the turn. */
export interface GuideProvider {
  run(input: { scope: { kind: "intake"; materialIds: readonly string[] } | { kind: "topic"; topicId: string };
    text: string; anchor?: SelectionAnchor; instruction?: string; history: readonly GuideTurn[] },
    // `onStep` appends when `index` equals the number of steps so far, and replaces the step at `index` otherwise.
    options: { signal: AbortSignal; onStep(step: TurnStep, index: number): void; onChoices(choices: readonly string[]): void }):
    Promise<{ readonly status: "completed" | "stopped" } | { readonly status: "failed"; readonly error: string }>;
}
```

```ts
// src/core/host.ts
export interface ToolServerPort {
  /**
   * Serves `handle` at a loopback HTTP endpoint that only accepts POST requests carrying the returned headers.
   * A non-empty result is sent as an `application/json` body; an empty result is answered with 202 and no body.
   * Requests without the headers get 401, other methods 405. The endpoint lives until `close()`.
   */
  open(handle: (requestBody: string) => Promise<string>): Promise<{
    readonly url: string;
    readonly headers: readonly { readonly name: string; readonly value: string }[];
    close(): Promise<void>;
  }>;
}

export interface HostPort {
  // existing members unchanged
  readonly toolServer?: ToolServerPort;
}
```

`WorkspaceStoragePort` 增加 `copy(from, to)`，供画像留底使用。

---

## 5. 注意力引擎（`AttentionEngine`）

所有交互收束到课题与材料本身，不出现会话列表。

1. **看板快照（`compass()`）**：聚合三种状态的课题、材料库（每份材料附引用它的课题）与无法读取的条目；从进行中的课题里选第一个带 `nextAction` 的作为今日焦点。
2. **立项（`intake()`）**：没有向导时直接拒绝。立项回合的进度经 `onUpdate` 送到首页。向导调用 `pith_create_topic` 成功的那一刻课题写入磁盘（引擎从带 `topic` 结果的工具步骤得知），`previous` 里的回合与这个回合依次成为新课题对话的开头。在那之前失败或被停止，或者向导只是反问了一个问题，磁盘上不留课题，回合只存在于返回值里。
3. **课题回合（`runTurn()`）**：同一课题同一时刻只有一个运行中的回合。回合开始即落盘用户消息；过程步骤经 `onUpdate` 逐步送出；结算后落盘终态。前台回合不设期限，由 `signal` 停止。
4. **记录（`capture()`）**：高亮、笔记与实训记录立即落盘。写在课题上的记录同时合并入队一条 `(prepare-next-action, topicId)` 后台任务。
5. **后台任务队列（`_cache/effects.json`）**：`enqueueEffect` 对处于 `pending` 的同 `(kind, key)` 任务原地替换 `payload`；进程重启后首次 `processDueEffects()` 把残留的 `running` 项恢复为 `pending`。后台任务没有人能按停止，由处理器自带期限。
6. **没有向导时**：投喂、阅读、高亮、材料级笔记、搁置与恢复照常可用；立项、课题回合、结题与行间翻译不可用，并说明原因。

---

## 6. 插件运行时（`PluginRuntime`）

[`PluginRuntime.compose()`](../../src/core/pluginrt/runtime.ts) 按四层优先级决定每个插件的开启状态：

```text
Layer 1: default（默认全开）
  ↓
Layer 2: preset（"essentials" 预设下关闭 essential: false 的扩展插件）
  ↓
Layer 3: user（显式插件配置）
  ↓
Layer 4: inUse 守卫 + 传递依赖提权
```

- **存档保活**：只要工作区里有课题（`toolkits`）或材料（`aids`）正在使用某插件（`manifest.inUse() > 0`，或 `inUse()` 抛错处于未知状态），该插件强制保持开启（`source: "in-use"`），并把它 `requires` 链上的服务提供者一并拉起。
- **栈式服务表与热重挂**：[`reconcile()`](../../src/core/pluginrt/runtime.ts) 比对当前配置与新配置；某插件停用或配置变更时，先按激活逆序卸载它和下游依赖方，再按拓扑顺序重新挂载。

---

## 7. 验证命令

```bash
npm run test:file -- tests/pluginrt.test.ts tests/store.test.ts tests/engine.test.ts
```
