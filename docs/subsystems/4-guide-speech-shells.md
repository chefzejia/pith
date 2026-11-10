# 子系统 4：认知管家向导、课程拆解、按需语音与多态宿主壳（`guide-acp` · `speech-service` · `shells`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [3-dojos.md](3-dojos.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 职责与边界

对应人类认知训练管线的 **第 2 阶段：SFT（认知管家、课程拆解与工具编排 [`guide-acp`](../../src/plugins/guide-acp/index.ts)）**、**第 4 阶段：Eval（结题门禁与权重合并 [`pith_settle_topic`](../../src/plugins/guide-acp/tools.ts)）**、**篇幅级神经语音伴读基础设施（[`speech-service`](../../src/plugins/speech-service/index.ts) & [`shells/speech`](../../src/shells/speech/index.ts)）**，以及将统一工作台适配到不同原生运行环境的**多态宿主薄壳（[`src/shells/`](../../src/shells/)）**。

---

## 2. 认知管家 Prompt 协议、三类课程拆解与工具动态编排（`guide-acp`）

### 2.1 核心定位：私人课程架构师与注意力管家（继承并升级自 `ganfan-garden`）

向导（Guide）绝不是阅读器旁边的被动问答机器人，而是**认知管理管家与私人课程架构师**。每次对话时，[`buildScenePrompt`](../../src/plugins/guide-acp/index.ts) 自动聚合 `<workspace>/ME.md`（已知基座、擅长类比、学习偏好与常见卡点）、当前 `Topic` 元数据、绑定的 `Material`（含文件名清单或绑定的 Git 仓库 `externalPath / commitSha`）、历史 `notes` 账本、当前选区 `SelectionAnchor` 以及全量可用 `Toolkit` 的编排指南，注入以下结构化指导协议：

```markdown
你是用户的私人课程架构师、注意力管家与后训练（Post-training RL）教练。你的目标是结合学习者画像（`ME.md`），帮他用最省注意力的方式，在“一手材料/递进讲义理解 + 原位脚手架实训反馈”中真正吃透当前课题（Topic）。

### 1. 开启或推进课题时（因人施教 · 三类课题分流）：
- 先阅读学习者画像 `ME.md`，找准用户在本课题中最想解决的核心问题，并用他最熟悉的领域做类比跳板。
- **情况 A：无现成教材的庞大认知/架构型课题（如学习 DSH / magpie 等代码仓库、攻克陌生学科或宽泛意图）**
  1. 主动使用 `pith_list_repository_files` / `pith_read_repository_file`（或 `pith_read_material_section`）侦察材料结构，揪出**唯一主线论题**；
  2. 先调用 `pith_write_lesson` 规划《`00-课程大纲.md`》（将庞大主题由浅入深拆解为 3~6 讲递进路线），并生成第一讲《`01-xxx.md`》精炼讲义（包含：学习目标、开场真问题、带可核对 `commit` 与 `path:line` 出处的有据走读、````pith-teaching```` 检验卡与 1 个 15 分钟微实验）；
  3. **仓库走读铁律**：必须严格区分“源码直接支持的事实”、“基于证据的推断”与“教学类比”，每个源码事实须附带 `path:line` 出处；未读取的文件绝不编造。
- **情况 B：已有现成书籍/论文/音视频的伴读型课题**
  - 不做替代原著的速食摘要机；读取目录或当前章节，提炼全书/全篇主线论点与必读路线（必要时用 `pith_write_lesson` 生成《`00-导读路线.md`》），协助拆解卡壳段落，每节给出 1 个检验理解的生成式问题。
- **情况 C：需要具身反馈的技能型课题（如外语口语跟读、表达训练、器乐/编程实操）**
  - 结合学习者带回的 `practice` 漏词/盲区记录进行精准诊断，每次派发一个 15 分钟内可完成的具体微练习（更新 `nextAction`）。

### 2. 脚手架工具（Toolkits）的自动识别与动态 CRUD：
- 根据当前课题的真实意图，主动评估可用工具包（`interline` 行间双语、`shadowing` 影子跟读、`feynman` 费曼复述）：
  - 外文原著阅读受阻时挂载 `interline`；需要口语/语音跟练时挂载 `shadowing`；需要检验概念、架构或源码因果链内化时挂载 `feynman`；若某工具不再需要或干扰专注，主动将其移除。
- 需要挂载、增补或移除工具时，调用 `pith_configure_toolkits` 或在回复末尾输出 `pith-toolkits` JSON 数组围栏。

### 3. 后训练笔记收录、选项胶囊（`pith-choices`）与毕业门控：
- 当用户发来选区思考或实训复盘时，先调用 `pith_save_note` 原汁原味收入账本；发现用户新的知识基座或偏好时，同步更新 `ME.md`。
- **每次回复末尾，必须用 ````pith-choices```` 代码块给出 2~4 个具体的下一步可点击选项胶囊**（每行一个选项），让用户点按即可丝滑推进下一讲或下一步实训。
- **毕业门控（Settlement Gate）**：用户发起总结沉淀时，先回顾全部笔记并提出恰好 1 道需要独立解释因果链、反例辨析或跨场景迁移的深水区问题（本轮严禁直接调用 `pith_settle_topic`）；只有用户回答证明真懂后，才调用 `pith_settle_topic` 写入《核心认知总结》并反哺更新 `ME.md`。
```

### 2.2 动态快捷胶囊槽（[`quickActionsForTopic`](../../src/plugins/guide-acp/index.ts)）

向导侧栏顶部的快捷胶囊区采用**「基础场景槽 + 已挂载 Toolkit 贡献槽」**动态合成：
- **基础场景槽**：
  - 若当前课题尚无阅读文件或刚绑定代码仓：优先显示 **`规划课程大纲与第一讲`**；
  - 若已有材料文件：显示 `导读这一节`、`考考我 / 下一步`；
  - 仅当课题已存在至少一条学习者笔记（`topic.notes.length > 0`）时，才解锁显示 **`总结沉淀`** 毕业胶囊；
- **Toolkit 贡献槽**：遍历当前课题 `topic.toolkits` 中已激活的 `Toolkit`，动态合并其 `quickActions`（如 `shadowing` 注入 `分析跟读`，`feynman` 注入 `费曼深水区追问`）。

### 2.3 多步工具读取与执行回路（Multi-Step Tool Loop & Trailing Directives）

为了让向导在拆解代码仓库或长文档时能够**“先读取目录/源码，拿到真实内容后再撰写讲义”**，[`LocalAcpGuideProvider.reply`](../../src/plugins/guide-acp/acpSession.ts) 支持多步工具循环（最多 4 轮）：
1. 若向导在某轮回复末尾输出了只读查询类 `pith-tool`（如 `pith_get_context`、`pith_read_material_section`、`pith_list_repository_files`、`pith_read_repository_file`），宿主立即在受控沙盒内执行该工具，并将工具返回的 JSON 结果作为下一拍上下文回喂给向导继续生成最终讲义与回复；
2. 写操作工具（`pith_write_lesson`、`pith_save_note`、`pith_configure_toolkits`、`pith_settle_topic`、`pith_ingest_external`）与尾部围栏（`pith-toolkits`、`pith-choices`）在校验课题作用域后落盘执行，触发左侧 Stage 与顶栏工具槽即时刷新。

### 2.4 受控工作区工具表（[`tools.ts`](../../src/plugins/guide-acp/tools.ts)）

向导子进程以只读权限启动（[`buildReadOnlyAgentEnv`](../../src/plugins/guide-acp/acpSession.ts)），所有工作区与绑定仓库操作仅能通过以下受控工具执行：

| 工具名称 | 核心职责与安全门禁 |
| :--- | :--- |
| `pith_get_context` | 读取 `ME.md`、课题看板快照、指定 `Topic` 详情及绑定的 `Material` 文件清单 |
| `pith_read_material_section` | 按 `text:line:<N>` 有界读取材料包内文本文件（或列出材料文件清单） |
| `pith_list_repository_files` | **代码仓库侦察**：分页列出当前课题绑定 Git 仓库（`kind === "repo"`）在绑定 `commitSha` 快照下的普通文件路径列表（拒绝符号链接与未提交工作区脏文件） |
| `pith_read_repository_file` | **代码仓库精读**：只读当前课题绑定 Git 仓库在绑定 `commitSha` 下的指定 UTF-8 源码文件（支持行区间或有界截断，返回精确 `commitSha`、`path` 与 `startLine..endLine`） |
| `pith_write_lesson` | **递进讲义生成**：向当前课题的材料包写入《`00-课程大纲.md`》或《`01-xxx.md`》讲义（若当前课题尚无 `materialId`，自动创建并绑定专属材料包；严禁覆盖原始导入文件） |
| `pith_configure_toolkits` | **工具动态 CRUD**：校验并更新当前课题挂载的 `topic.toolkits`（支持增、删、重置） |
| `pith_save_note` | 向当前课题追加 `note`、`highlight` 或 `practice` 记录及向导评注 `guideRemark` |
| `pith_ingest_external` | 经 SSRF 公网 IP 校验抓取外部文章/讨论/媒体并导入为只读 `Material` |
| `pith_settle_topic` | **硬性毕业门禁**：校验 `status === "exploring"` 且 `topic.notes.length > 0`，追加 `## 核心认知总结`、将课题置为 `settled` 并支持反哺更新 `ME.md` |

---

## 3. 篇幅级神经语音伴读与按需本机网关（`speech-service` & `speechRuntime.ts`）

1. **非正文严格剔除与双位置解耦**：[`filterProseOnly`](../../src/plugins/speech-service/index.ts) 仅提取 `isProse === true` 的块朗读；听读期间手动翻页不中断播放，底部播客甲板提供 `[跳回朗读处]`。
2. **零 Python 依赖的 Vault 外本机语音守护进程（[`NodeManagedSpeechRuntime`](../../src/shells/speech/speechRuntime.ts)）**：
   - 模型与运行时安装在 Vault 之外的系统目录（默认路径与 `PITH_SPEECH_HOME` 规则见 [`NodeManagedSpeechRuntime`](../../src/shells/speech/speechRuntime.ts)），支持实时下载进度、断点续传、SHA-256 强校验与取消控制；
   - 默认 TTS 为 **ZipVoice INT8（中英双语）**，使用预置参考音色（[`ZIPVOICE_PRESETS`](../../src/shells/speech/speechVoices.ts)）与 8 步生成，ASR 为 **SenseVoice INT8（多语种）**；原生运行时、模型下载地址及哈希由 [`SPEECH_MODEL_ASSETS`](../../src/shells/speech/speechRuntime.ts) 定义，在设置面板提供本机/云端音色选择器，严禁在运行时调用宿主机 `python3` 或 `pip`。

---

## 4. 多态原生宿主薄壳（`src/shells/`）

同一套 `src/core/`、`src/plugins/` 与统一图形工作台 `src/workbench/` 通过 [`HostPort`](../../src/core/host.ts) 适配三种原生宿主环境：

| 宿主壳 | 入口文件 | 核心适配职责 |
| :--- | :--- | :--- |
| **Obsidian 插件壳** | [`src/shells/obsidian/index.ts`](../../src/shells/obsidian/index.ts) | 将 Obsidian `Vault.adapter` 映射为 `WorkspaceStoragePort`，注入本地 Git 仓库只读检视器（`repositoryPort`），挂载统一工作台视图并接入系统钥匙串 `secretStorage`。 |
| **独立 Web 桌面壳** | [`src/shells/web/cli.ts`](../../src/shells/web/cli.ts)<br>[`src/shells/web/server.ts`](../../src/shells/web/server.ts) | 基于 Node 文件系统、本地 Git 仓库只读检视器与本地 HTTP 服务（默认 `http://127.0.0.1:4173`）挂载同一份统一图形工作台。 |
| **DSH 宿主壳** | [`src/shells/dsh/index.ts`](../../src/shells/dsh/index.ts) | 同时导出统一图形工作台视图与 [`createDshPluginBundle`](../../src/shells/dsh/index.ts)。 |

---

## 5. 验证命令

```bash
node --experimental-strip-types --test tests/wave3-track2-guide-tools.test.ts tests/track1-guide-providers.test.ts tests/task15-speech-runtime.test.ts tests/wave2-trackB-shells.test.ts
```
