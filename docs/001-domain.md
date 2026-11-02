# 001 Domain Model

本文档定义 Pith 的核心领域模型与持久存储契约。遵循 [000 Philosophy](000-philosophy.md)，内核代码、MCP 工具、插件接口与文档严格使用以下中性词汇，不再混用历史隐喻词。

## 1. 核心词汇表与表层解耦（Core Terms vs. Surface Persona）

为了确保架构跨越不同学科（阅读、编程、外语、器乐、决策复盘）十年不过时，Pith 将**「内核真名（Core Domain）」**与**「表层角色皮肤（Surface Persona）」**严格分离：

| 概念维度 | 内核真名（代码 / 协议 / 文件，永不改变） | 默认表层文案（温和花园风） | 极客表层文案（纯粹工作台风） | 废弃历史词（严禁再出现） |
| :--- | :--- | :--- | :--- | :--- |
| **品牌与命令** | `Pith` (`pith`, `.pith-*`) | Pith | Pith | `Sylva`, `Ganfan Garden`, `.gg-*` |
| **工作区根目录** | `Workspace` | 花园 / 空间 | 工作区 (Workspace) | `Garden/` (硬编码路径) |
| **个人认知基座** | `Profile` (`ME.md`) | 学习者画像 (`ME.md`) | 个人基座 (`ME.md`) | - |
| **探索课题单元** | `Topic` (`topics/<id>/topic.md`) | 课题 / Topic | 课题 (Topic) | `Seed`, `Thread` |
| **可观测材料包** | `Material` (`materials/<id>/`) | 材料 | 材料 (Material) | `Source`, `SourceRecord` |
| **思考与磕绊记录** | `Note` & `SelectionAnchor` | 笔记与高亮 | 笔记与锚点 (Note) | `Bloom`, `Gap`, `Attempt` |
| **AI 引导协作者** | `Guide` (`pith-choices`) | 园丁 (Gardener) | 导师 / 向导 (Guide) | `GardenerService` (内核层) |
| **渐进式实训工具** | `DojoToolkit` (`toolkits`) | 实训工坊 | 训练场 (Dojo) | `Echo`, `EchoModal` |

## 2. 四大核心实体（The Core Quartet）

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
│  - toolkits: 按需挂载的实训插件 ID 列表 (如 ["shadowing"])          │
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

### 实体守则：
1. **`Profile`（`ME.md`）**：全工作区唯一。记录用户是谁、懂什么、习惯怎样的类比。向导（Guide）在规划任何 Topic 前先读它；当一个 Topic 达成目标转为 `settled` 时，将新掌握的认知模型反哺更新回 `ME.md`。
2. **`Topic`**：管理注意力的基本单位。一个 Topic 聚焦一个明确的问题或技能目标（`target`）。`exploring` 状态的 Topic 数量应当保持克制，防止注意力溃散。
3. **`Material`**：可观测的实体材料。原始导入文件（EPUB、PDF、音视频、图片）**100% 只读，永不改写、重命名或删除**；若 Topic 起步于一个无现成材料的纯粹问题，向导生成的《课程大纲》与《单课讲义》（`00-outline.md`、`01-xxx.md`）作为材料文件写入该 Material 包中，使抽象思考转化为可划重点、可定位的可观测文件。
4. **`Locator` & `SelectionAnchor`**：与屏幕尺寸、窗口大小、字号完全无关的材料内在坐标：
   - 流式文本：`text:section:<n>;block:<m>;offset:<k>` 或 `range:...`
   - 定版页面：`page:<n>`
   - 时间轴媒体：`time:<seconds>`
   - 代码仓库：`repo:<commitSha>:<path>#L<start>-L<end>`

## 3. 工作区物理目录树契约（Workspace Layout）

纯文本 Markdown 是唯一持久事实源（Single Source of Truth），`_cache/` 是随时可删、可完全重建的投影缓存：

```text
<workspace-root>/
├── ME.md                               # 学习者个人认知基座画像
├── plugins.yml                         # 插件开关、预设 (essentials | all) 与各插件配置
├── topics/
│   └── topic-<id>/
│       └── topic.md                    # Topic 元数据 (Frontmatter) + 完整笔记/高亮/实训账本
├── materials/
│   └── material-<id>/
│       ├── material.md                 # 材料包元数据、文件清单与各文件阅读进度 locator
│       └── files/
│           └── <name>                  # 只读原始材料文件或向导生成的课程讲义
└── _cache/                             # 可随时删除重建的本地缓存
    ├── conversations/                  # 按 Topic 跨天持久化的向导对话流 (<topic-id>.json)
    └── effects.json                    # 后台异步任务队列快照 (拉取/转写/备课)
```
