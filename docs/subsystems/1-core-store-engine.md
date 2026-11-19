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
7. **记录标明作者。** 每条高亮、笔记与实训记录带 `author`：经工作台界面写入的是 `user`，经向导工具写入的是 `guide`，由写入的通道决定，调用方不能自行指定。要求「用户自己的记录」的地方（结题门禁、「总结沉淀」快捷动作）只数 `author` 为 `user` 的笔记与实训记录。
8. **画像只在结题时由向导写入。** 观察条目的新增只发生在 `pith_settle_topic` 里；撤回发生在 `pith_settle_topic` 里，或由用户在对话里撤销。
9. **Pith 不删除任何课题或材料。** 工作区是普通文件，可以在文件管理器里删除；删除后悬空的引用由看板的「无法读取」分区报告，不自动修复。
10. **同一仓库的版本。** `kind: repo` 且 `externalPath` 相同的材料是同一仓库的不同版本，按 `createdAt` 排序，最近导入的是最新版本。导入新版本是新建一份材料，旧版本不变；课题改用新版本是追加引用，旧版本的引用保留（不变量 4），记在旧版本上的笔记照常指向旧代码。
11. **讲义记下依据的版本。** 每一讲在课题账本里记下写入时本课题每个仓库引用的最新版本（`basedOn`）。讲义里的仓库出处只在这些版本里解析；课题里某个仓库有了比 `basedOn` 更新的版本，这一讲就是「基于旧版本」。课题改用某仓库的新版本时，程序比较这一讲依据的提交与新提交：这一讲引用的文件（[2-stages.md](2-stages.md) 第 2 节）都没有变化的，由程序直接改依据（`rebaseLesson`）；有变化的保持「基于旧版本」，并列出变化的文件。比较失败时不改依据。

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
    ├── feynman/<source>/<file>.<passage-hash>.json  # 复述要点清单
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
  - material-dsh
  - material-magpie
nextAction: 读《01-内核边界.md》，用费曼复述 dsh 的服务注入
toolkits:
  - feynman
lessons:
  - name: 00-课程大纲.md
    locator: "text:line:0"
    lastActiveAt: "2026-11-12T10:15:00.000Z"
    basedOn: "material-dsh,material-magpie"
  - name: 01-内核边界.md
    basedOn: "material-dsh,material-magpie"
createdAt: "2026-11-12T10:00:00.000Z"
updatedAt: "2026-11-12T10:15:00.000Z"
---

## [note] 2026-11-12T10:15:00.000Z
<!-- pith-note:v1 -->
- id: "note-1"
- author: "user"
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
- `materials` 的每一项是材料 ID，与讲义的 `basedOn`、笔记的 `material` 写法一致；不用 Obsidian 双链，Pith 不依赖任何宿主的链接语法。材料 ID 只含小写字母、数字与 `-`，其他写法的条目让整个课题按无法读取处理。
- 讲义条目的 `basedOn` 是逗号分隔的材料 ID：只列 `kind: repo` 的材料，每个仓库至多一个版本，且都在 `materials` 里；是平铺标量，因为 frontmatter 解析器不支持列表项里嵌套列表。没有仓库材料的课题不写这个字段。缺省 `basedOn` 的讲义视为基于本课题每个仓库最早引用的版本。
- 记录以 `## [highlight|note|practice] <timestamp>` 开头，以 `<!-- pith-note:v1 -->` 至 `<!-- pith-note:end -->` 定界。每条记录有 `- id` 与 `- author: "user"` 或 `- author: "guide"` 两行。带锚点的记录另有三行：来源（`- material: "<id>"` 或 `- lesson: true`，二者必居其一）、`- file` 与 `- locator`；不带锚点的记录这三行都没有。
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
readingFile: "packages/core/README.md"
readingLocator: "repo:a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2:packages/core/README.md#L12-L12"
readingOpenedAt: "2026-11-14T03:00:00.000Z"
---
```

- `kind` 为 `book | article | media | discussion | repo`。`aids` 与 `files` 两个列表必须出现，可以为空。`files` 每项含 `name`、`mimeType`、`bytes`、64 位十六进制 `sha256`、可选的 `locator` 与 `lastActiveAt`。
- `aids` 是在这份材料上开启的阅读辅助 ID 列表（目前只有 `interline`）。导入时按材料语言预置，见 [3-toolkits.md](3-toolkits.md)。
- `readingFile`、`readingLocator`、`readingOpenedAt` 三个可选字段记录这份材料最后一次打开的位置：`readingFile` 是最后打开的文件，`readingOpenedAt` 是打开时间（ISO 时间戳），`readingLocator` 是该文件内的内在坐标，可缺省。`readingFile` 与 `readingOpenedAt` 必须同时出现或同时缺省；`readingLocator` 不能单独出现，否则解析失败并进入「无法读取」。仓库材料的 `files` 为空，它的 `readingFile` 是绑定提交里的仓库相对路径，适用 3.6 的第二套规则；其余材料的 `readingFile` 必须是 `files` 里的文件名。字段是平铺标量，因为 frontmatter 解析器只支持标量与标量列表。
- 阅读位置属于材料，不属于缓存：`_cache/` 删除后，首页材料库与课题内都从 `material.md` 恢复最后打开的文件、坐标与时间。`files` 每项的 `locator` 与 `lastActiveAt` 仍是非仓库材料各个文件自己的位置，`reading` 只多记「最后打开的是哪一个」。
- `remoteUrl` 是可选标量，只出现在 Pith 克隆的仓库材料上，值是规范化的远端地址 `https://github.com/<owner>/<repo>`；这时 `externalPath` 指向 Pith 管理的克隆目录（[ARCHITECTURE.md](../ARCHITECTURE.md) 第五节）。本地仓库材料没有这个字段。
- 正文是材料级记录，格式与 `topic.md` 的记录相同，只允许 `highlight` 与 `note`，来源行固定指向材料自身，`author` 固定为 `user`。

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
- 向导只在结题时写入（第 2 节不变量 8）。
- 每条观察占两行。第一行是 `- id: "<id>" · <日期> · <课题 ID>`，有证据笔记时再接 ` · <笔记 ID>`；第二行缩进两个空格，是观察正文。正文是单行文本，不超过 500 字，写入前把换行折成空格。日期取写入时刻 ISO 时间戳的日期部分（UTC）。
- 每次写入前，把当前 `ME.md` 复制到 `history/ME-<timestamp>.md`，`<timestamp>` 形如 `20261112T101500123Z`。复制失败则不写入。

### 3.5 `conversation.json`

一个 JSON 数组，元素是回合（`GuideTurn`，见第 4 节），按时间先后排列。回合开始时以 `running` 状态落盘，此时已含用户消息；结算时改写为终态。加载时仍是 `running` 而没有对应的运行中请求的回合，按 `stopped` 显示，原因为进程中断。

工具步骤只保存工具名、输入的有界预览与结果摘要，不保存完整输入（例如讲义全文）。

### 3.6 安全语义

两类名字的规则不同：

**Pith 控制的存储名字**（`topicId`、`materialId`、讲义文件名）：禁止包含 `/`、`\`、`\0`；禁止是 `.` 或 `..`；允许扩展名（`00-课程大纲.md` 是合法讲义名，`.` 在扩展名里合法）。讲义文件名必须以 `.md` 结尾。这些名字直接用于目录路径拼接，不能有路径分隔符或父目录引用。

**锚点的仓库相对路径**（`SelectionAnchor.file`，仅当来源是 `material` 且对应的是 `repo` 类型材料时）：允许 `/`（路径分隔符）与 `.`（文件扩展名与当前目录引用），禁止 `..` 路径段（防路径穿越），禁止以 `/` 开头（相对路径）。宿主负责把它限定在绑定仓库根目录内解析，解析结果须在根目录下；校验在宿主层，内核只存储字符串。材料 `files/` 下的非仓库文件的锚点 `file` 是材料内部的文件名，适用第一套规则。仓库搜索与比较的路径参数适用同一套规则。

**远端仓库地址**：只接受 `github.com` 上的仓库根地址，HTTPS 形式 `https://github.com/<owner>/<repo>`（可带 `.git` 或结尾的 `/`）与 SSH 形式 `git@github.com:<owner>/<repo>.git`。`<owner>` 与 `<repo>` 只含字母、数字、`-`、`_`、`.`，且不是 `.` 或 `..`；规范化后克隆到仓库目录下的 `github.com/<owner>/<repo>`。其他地址按普通网页处理。

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
  /** Who wrote the record; set by the channel it came through, never by the caller's input. */
  readonly author: "user" | "guide";
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
  /** Repository material IDs this lesson was written against, one version per repository; stamped by the store. */
  readonly basedOn?: readonly string[];
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

/** Where the learner last opened this material. Permanent: it lives in `material.md`, never in `_cache/`. */
export interface MaterialReading {
  /** A name listed in `files`, or the repository-relative path of a `repo` material. */
  readonly file: string;
  readonly locator?: IntrinsicLocator;
  /** ISO timestamp of the last open. */
  readonly openedAt: string;
}

export interface Material {
  readonly id: string;
  readonly title: string;
  readonly kind: MaterialKind;
  readonly createdAt: string;
  readonly files: readonly MaterialFileEntry[];
  readonly externalPath?: string;
  readonly commitSha?: string;
  /** Normalized GitHub URL; present only on repositories that Pith cloned. */
  readonly remoteUrl?: string;
  /** Reading-aid toolkit IDs enabled on this material. */
  readonly aids: readonly string[];
  /** Absent until the material has been opened once. */
  readonly reading?: MaterialReading;
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
// src/core/library.ts — 纯函数，不读写存储
export interface LibraryMaterialEntry {
  readonly id: string;
  readonly title: string;
  readonly kind: MaterialKind;
  readonly createdAt: string;
  /** reading.openedAt, when the material has been opened. */
  readonly lastOpenedAt?: string;
  /** Records kept on the material itself, outside any topic. */
  readonly noteCount: number;
  /** kind: repo only. source is remoteUrl, else externalPath; latest follows materialVersionGroups. */
  readonly repository?: { readonly source: string; readonly commit: string; readonly latest: boolean };
  /** Topics whose materials list links this material. */
  readonly topics: readonly { readonly id: string; readonly title: string; readonly status: TopicStatus }[];
}
export interface LibraryTopicEntry {
  readonly id: string;
  readonly title: string;
  readonly target: string;
  readonly status: TopicStatus;
  readonly materialIds: readonly string[];
  readonly lessonCount: number;
  /** Notes and practice records whose author is the user. */
  readonly userRecordCount: number;
  readonly updatedAt: string;
}
export interface LibraryOverview {
  readonly materials: readonly LibraryMaterialEntry[];
  readonly topics: readonly LibraryTopicEntry[];
}
export function libraryOverview(materials: readonly Material[], topics: readonly Topic[]): LibraryOverview;
```

`libraryOverview` 是「哪些课题引用了这份材料」的唯一算法，依据是课题的 `materials` 列表（3.2）；首页材料库、场景提示词与向导工具都调用它。材料按最近活动倒序：取 `lastOpenedAt`、`createdAt` 与引用它的课题的 `updatedAt` 中最晚的一个；课题按 `updatedAt` 倒序。

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
  /** Writes or overwrites a lesson and stamps `basedOn` with the latest version of each repository the topic references. */
  writeLesson(topicId: string, fileName: string, markdown: string): Promise<Topic>;
  /** Re-stamps `basedOn` of an existing lesson to the latest versions without changing its content. */
  rebaseLesson(topicId: string, fileName: string): Promise<Topic>;
  readLesson(topicId: string, fileName: string): Promise<string>;
  updateLessonLocator(topicId: string, fileName: string, locator: IntrinsicLocator): Promise<void>;

  listMaterials(): Promise<readonly Material[]>;
  getMaterial(materialId: string): Promise<Material | null>;
  /** A repo import whose `externalPath` and `commitSha` match an existing material returns that material unchanged. */
  importMaterial(input: ImportMaterialInput): Promise<Material>;
  setMaterialAids(materialId: string, aids: readonly string[]): Promise<Material>;
  appendMaterialNote(materialId: string, note: AppendNoteInput): Promise<Note>;
  updateReadingLocator(materialId: string, fileName: string, locator: IntrinsicLocator): Promise<void>;
  /** Records the last opened file and position and stamps openedAt itself. A repo material takes a repository-relative path (3.6); any other material takes a name listed in `files`. */
  recordReading(materialId: string, input: { file: string; locator?: IntrinsicLocator }): Promise<void>;

  listUnreadable(): Promise<readonly UnreadableEntry[]>;
}

export interface AppendNoteInput {
  readonly kind: NoteKind;
  readonly author: "user" | "guide";
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
  /** Only for repositories that Pith cloned; a normalized GitHub URL (3.6). */
  readonly remoteUrl?: string;
  /** Reading aids to enable from the start; the caller decides them from a text sample. */
  readonly aids?: readonly string[];
}
```

`updateTopic` 只接受 `exploring ⇄ shelved` 与 `exploring → settled` 两种状态变化，其余抛错。`appendMaterialNote` 拒绝 `practice` 与 `author` 为 `guide` 的记录。原有的 `writeProfile`、`writeGeneratedFile`、`appendMaterialFiles`、`updateTopicIfUnchanged` 与 `toolkitsOrigin` 不再存在。

`recordReading` 只写 `reading` 三个字段，不改动 `files`、`aids` 与材料级记录。它拒绝：空文件名与含 NUL 字符的名字；仓库材料里含 `..` 路径段或以 `/` 开头的路径；非仓库材料里不在 `files` 中的文件名。`updateReadingLocator` 继续只服务非仓库材料逐文件的位置。

`writeLesson` 与 `rebaseLesson` 自己计算 `basedOn`（不变量 10、11），调用方不能指定；课题没有仓库材料时不写这个字段。`rebaseLesson` 只改账本里这一讲的 `basedOn`，讲义文件的字节不变；讲义不存在时抛错。材料 ID 由 Pith 生成，只含小写字母、数字与 `-`，所以 `basedOn` 可以用逗号分隔。

`importMaterial` 对 `kind: repo` 先找 `externalPath` 与 `commitSha` 都相同的材料，找到就原样返回，不新建、不改动。`remoteUrl` 只接受 3.6 规范化后的 GitHub 地址，且只能和 `kind: repo` 一起出现。

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
      readonly status: "running" | "completed" | "failed"; readonly summary?: string; readonly effects: readonly TurnEffect[] }
  | { readonly kind: "reply"; readonly markdown: string };

export interface GuideTurn {
  readonly id: string;
  readonly status: TurnStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly user: {
    readonly text: string;
    readonly anchor?: SelectionAnchor;
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
  runTurn(input: { topicId: string; text: string; anchor?: SelectionAnchor }, options?: TurnOptions): Promise<GuideTurn>;
  /** Runs a failed or stopped turn again with the same user message, replacing that turn. */
  retryTurn(topicId: string, turnId: string, options?: TurnOptions): Promise<GuideTurn>;

  /** Records a highlight, note or practice result on a topic, or a highlight or note on a material. The record's author is `user`. */
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
    text: string; anchor?: SelectionAnchor; history: readonly GuideTurn[] },
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

export interface RepositorySearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface RepositoryChange {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly previousPath?: string;
  readonly additions: number;
  readonly deletions: number;
}

export interface RepositoryPort {
  // inspectRepository, listFiles and readFile unchanged
  /** Searches the text files of one commit; literal unless `regex` is set. */
  searchFiles(externalPath: string, commitSha: string, query: {
    readonly pattern: string; readonly regex?: boolean; readonly caseSensitive?: boolean;
    readonly pathPrefix?: string; readonly limit?: number }):
    Promise<{ readonly matches: readonly RepositorySearchMatch[]; readonly truncated: boolean }>;
  /** Files that differ between two commits of one repository, paged. */
  listChanges(externalPath: string, fromSha: string, toSha: string, offset?: number, limit?: number):
    Promise<{ readonly changes: readonly RepositoryChange[]; readonly total: number; readonly nextOffset: number | null }>;
  /** Unified diff of one file between two commits. */
  readChange(externalPath: string, fromSha: string, toSha: string, filePath: string, maxLines?: number):
    Promise<{ readonly path: string; readonly patch: string; readonly truncated: boolean }>;
  /** Clones a snapshot of a GitHub repository's default-branch head into the managed directory, or reuses the clone; pins that commit. */
  cloneRemote(remoteUrl: string, signal?: AbortSignal):
    Promise<{ readonly externalPath: string; readonly commitSha: string; readonly title: string; readonly remoteUrl: string }>;
  /** Fetches a snapshot of the default-branch head into a managed clone and pins that commit. */
  fetchRemote(externalPath: string, signal?: AbortSignal): Promise<{ readonly commitSha: string }>;
}
```

`WorkspaceStoragePort` 增加 `copy(from, to)`，供画像留底使用。

仓库端口的约束：

- **搜索**：只搜该提交里的 UTF-8 普通文件，跳过二进制和超过单文件上限（与 `readFile` 相同，256 KiB）的文件。`limit` 默认 50、最大 200，每条 `text` 最多 300 字符。`regex` 为真时按扩展正则匹配，正则无效时以原因失败。`pathPrefix` 适用 3.6 的仓库相对路径规则。
- **比较**：两个提交都必须在这个仓库里，只比较提交，不读工作区。`listChanges` 的 `limit` 默认 200、最大 1000；`readChange` 的 `maxLines` 默认 400、最大 2000，超出时 `truncated` 为真。
- **克隆**：仓库目录是 `PITH_REPOSITORY_HOME`（绝对路径），未设置时为 `~/Library/Application Support/pith/repositories/`，克隆放在其下的 `github.com/<owner>/<repo>`。每个版本只取那个提交的快照（深度为 1 的浅克隆），不检出工作区文件；之后每次拉取也只取默认分支最新提交的快照。比较两个版本只需要这两个快照，不需要中间的历史，所以不下载完整历史（大仓库的完整历史可达数百 MB）。`inspectRepository`、`listFiles`、`readFile` 与上面的搜索和比较对克隆同样可用。同一地址已经克隆过时复用并拉取，不重新克隆。`title` 是 `<owner>/<repo>`。
- **固定引用**：`cloneRemote` 与 `fetchRemote` 给返回的提交加引用 `refs/pith/pins/<sha>`。旧版本的快照靠它保留，不被 git 的垃圾回收清掉；上游改写历史后，材料绑定的提交也仍然可读。
- **凭据与失败**：克隆与拉取保留用户的全局 git 配置与 SSH 代理，以使用本机已有的登录凭据；其余只读命令照旧忽略全局与系统配置。git 不弹交互提示（`GIT_TERMINAL_PROMPT=0`）；需要登录、网络不可达或仓库不存在时，以原因失败。`signal` 中止时删除本次新建的不完整克隆目录。
- `fetchRemote` 只用于仓库目录里由 Pith 克隆的仓库；本地仓库检查更新时用 `inspectRepository` 读当前提交。

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
