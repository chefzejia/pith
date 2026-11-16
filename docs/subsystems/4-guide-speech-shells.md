# 子系统 4：向导、按需语音与宿主壳（`guide-acp` · `speech-service` · `shells`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [3-toolkits.md](3-toolkits.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 职责与边界

对应训练管线的监督微调（立项、拆课与工具编排，[`guide-acp`](../../src/plugins/guide-acp/index.ts)）与评测（结题门禁，[`pith_settle_topic`](../../src/plugins/guide-acp/tools.ts)），加上神经语音伴读（[`speech-service`](../../src/plugins/speech-service/index.ts) 与 [`shells/speech`](../../src/shells/speech/index.ts)）和把统一工作台适配到各运行环境的宿主壳（[`src/shells/`](../../src/shells/)）。

---

## 2. 向导（`guide-acp`）

向导是本机的 ACP Agent（dsh、claude、codex）。Pith 与它之间只有两条标准通道：

```text
Pith（guide-acp 插件）                       本机 Agent 进程
  │  ACP over stdio ───────────────────────▶  initialize · session/new · session/prompt
  │  ◀───────────────────────────────────── session/update · session/request_permission
  │
  │  MCP over loopback HTTP（Pith 是服务端）
  │  ◀───────────────────────────────────── tools/list · tools/call
```

回复正文只有文字。向导要读材料、写讲义、存笔记、给出下一步选项，一律调用工具；Pith 不从回复文本里解析任何指令。

### 2.1 一个回合

1. 引擎调用 [`GuideProvider.run`](../../src/core/engine/contract.ts)，作用域是「立项」或某个课题。
2. 插件经 [`ToolServerPort`](../../src/core/host.ts) 打开一个只服务本回合的工具端点。作用域在打开时确定，所以工具没有 `topicId` 参数，向导无法指向别的课题。端点实现 MCP 的 HTTP 方式的最小子集：每个请求一条 JSON-RPC 消息，以 JSON 回应，不开事件流；支持 `initialize`（协议版本回应客户端请求的那一个）、`ping`、`tools/list` 与 `tools/call`，其余带 `id` 的方法回「方法不存在」；不带 `id` 的通知一律接受，其中 `notifications/cancelled` 中止它所指的进行中调用。协议逻辑在插件里，宿主只负责收发。MCP 服务的名字固定为 `pith`。
3. 启动 Agent 进程，`initialize`、`session/new`（`mcpServers` 里是这个端点的地址与请求头），按设置选定模型与思考强度。
4. 发送一次 `session/prompt`，内容是场景提示词。整个回合只有这一次请求；Agent 在其中想调多少次工具就调多少次。
5. 把 `session/update` 与工具端点收到的调用，按到达顺序变成回合步骤（2.3）。
6. `session/prompt` 返回后回合结算，关闭会话、进程与端点。

Agent 会话每个回合用完即毁。跨回合的连续性来自场景提示词里的近期对话，不依赖 Agent 一侧的会话恢复。

**启动前的检查**（不满足即以 `failed` 结算并说明原因）：

- 设置里选了 Agent，且可执行文件可用。
- 宿主提供了 `process` 与 `toolServer`。
- `initialize` 的回应声明了 `mcpCapabilities.http`。
- 这个 Agent 登记了工具标题的形状（2.3）。目前只有 dsh 登记；claude 与 codex 的适配器都声明支持 HTTP 方式，但没有实测过工具调用、标题与权限，登记之前报不可用。

### 2.2 场景提示词

[`buildScenePrompt`](../../src/plugins/guide-acp/index.ts) 每个回合重新组装，内容依次是：

| 段落 | 内容 |
| :--- | :--- |
| 角色与规则 | 见下 |
| 画像 | `ME.md` 全文 |
| 课题 | 标题、目标、状态、下一步、已挂载的训练工具；立项作用域下改为「尚未创建」 |
| 材料 | 课题引用的每份材料：ID、标题、类型、文件清单或仓库的路径与提交；同一仓库的多个版本按导入先后列出，标明哪个是最新版本。立项作用域下列出用户带来的材料和材料库的全部条目 |
| 讲义 | 本课题已有讲义的文件名，以及每一讲依据的仓库版本；依据的不是最新版本的讲标明「基于旧版本」 |
| 记录 | 课题的高亮、笔记与实训记录，加上所引用材料上的材料级记录；每条标明作者是用户还是向导 |
| 当前选区 | 用户这条消息引用的原文及其来源 |
| 可用训练工具 | 每个已注册训练工具的 ID 与 `whenToUse` |
| 近期对话 | [`selectConversationHistory`](../../src/plugins/guide-acp/conversationMemory.ts) 从此前的回合里取：只取每个回合的用户消息与回复正文，最近 16 条，单条 2 000 字、合计 12 000 字以内，超长的保留首尾；最近一个回合附上当时给出的选项 |
| 用户消息 | 本回合的输入 |
| 本回合指令 | 工具经 `instruction` 给出的指令（如费曼复述的追问规则），没有则省略 |

规则（写进提示词，由模型遵守）：

- **立项**：先看材料再定课题。目标必须是一个能结题的问题；用户只给了材料没说清目标时，先问，不创建。创建课题后在同一回合写《`00-课程大纲.md`》（3 到 6 讲，每行 `- [01-xxx.md] 标题：一句话目标`）和第一讲正文，其余各讲等用户需要时再写。
- **讲义**：包含学习目标、一个真实问题、带出处的走读、`pith-teaching` 检验卡和一个 15 分钟微实验。源码事实标注提交与 `path:line`，区分事实、推断与类比；没读过的内容不写成事实。
- **代码**：找定义、调用点和配置时，先用 `pith_search_material` 搜索，再用 `pith_read_material` 读具体行。讲义里的 `path:line` 指向这一讲依据的版本。
- **新版本**：本回合指令要求按新版本调整讲义时，先用 `pith_compare_material` 看两个版本之间的变化，再逐讲判断：受影响的讲用 `pith_write_lesson` 重写，并在文中加一段「相对上一版的变化」；不受影响的讲用 `pith_rebase_lesson` 确认。最后在回复里列出改了哪几讲、为什么改。
- **书籍、长文与音视频**：读目录和当前章节，设计原作导读路线，不写替代原著的摘要；每节给一个检验理解的问题。
- **技能训练**：依据实训记录诊断，每次安排一个 15 分钟内能完成的练习。
- **工具**：按用户的真实目标增删训练工具。
- **选项**：每个回合结束前调用 `pith_offer_choices` 给出 2 到 4 个具体的下一步。
- **记住**：用户要求记住某件事时，用 `pith_save_note` 把它记成本课题的一条笔记，并说明画像在结题时才更新；不声称已写入画像。
- **结题**：用户提出总结沉淀时，先提一道需要独立解释因果、辨析反例或迁移应用的问题，这一回合不调用 `pith_settle_topic`；用户的回答证明理解之后才调用。不替用户作答。

### 2.3 回合步骤的来源

| 来源 | 变成的步骤 |
| :--- | :--- |
| `agent_message_chunk` | `reply`。带相同 `messageId` 的分块并入同一步；没有 `messageId` 时并入紧邻的上一个 `reply`。Agent 逐字发就逐字显示，整条发就整条显示 |
| `agent_thought_chunk` | `thought`，合并规则同上 |
| 工具端点收到 `tools/call` | `tool`。开始时 `running`，处理完成后带上摘要和可点开的结果（`TurnEffect`，可以有多个）。Pith 工具的步骤只由这一来源产生 |
| `tool_call` / `tool_call_update`，且不是 Pith 工具 | `tool`，只有名称与状态，没有可点开的结果 |
| `usage_update` 及其余更新 | 忽略 |

Pith 工具有没有被调用、结果是什么，以工具端点为准，不以 Agent 发来的更新为准。Agent 的 `tool_call` 更新只用于两件事：不重复显示 Pith 工具的步骤，以及回答权限请求（2.4）。

一条更新算作 Pith 工具，当且仅当它的标题与该 Agent 登记的形状完全相等。形状登记在 Agent 描述里（[`discovery.ts`](../../src/plugins/guide-acp/discovery.ts)），dsh 的是 `mcp__pith__<工具名>`，其中 `<工具名>` 必须是本回合提供的工具之一。不做后缀或包含匹配。

### 2.4 权限与只读

目标是：Agent 改动工作区与绑定仓库的唯一途径是 Pith 工具。各层各管一件事，互不替代：

| 层 | 管什么 | 不管什么 |
| :--- | :--- | :--- |
| **工具端点** | Pith 工具的全部写入。只监听回环地址，只接受带本回合随机令牌的请求，回合结束即关闭；每个工具执行前校验作用域：`materialId` 必须属于本课题引用的材料（立项作用域下是材料库里的材料），文件名与路径按 [1-core-store-engine.md](1-core-store-engine.md) 的规则校验 | 这是 Pith 工具唯一的安全边界。实测 dsh 在只读模式下对 MCP 工具直接放行，不发权限请求 |
| **宿主沙盒** | Agent 进程及其子进程对文件的直接写入。宿主以系统沙盒启动 Agent，禁止写入工作区根目录与本回合涉及的绑定仓库路径。工作区根目录由宿主的进程端口自己加入（插件不知道它的绝对路径），绑定仓库路径由插件经 `readOnlyPaths` 传入。工作目录是宿主为本回合新建的临时目录，回合结束即删除 | 目前只有 macOS 有实现；其他系统上这一层不存在 |
| **只读启动** | dsh 自带的写文件与执行命令工具：进程以只读权限模式启动（[`buildReadOnlyAgentEnv`](../../src/plugins/guide-acp/acpSession.ts)），首次写入被它自己的沙盒拒绝 | 不拦 MCP 工具；模型可以申请提权，由下一层拒绝 |
| **权限请求** | 对 `session/request_permission`：请求所指的调用是 Pith 工具（按 2.3 的规则，依据此前收到的、带同一 `toolCallId` 的 `tool_call` 更新）时选择一次性允许；其余一律选择一次性拒绝，包括没收到过对应更新的 | 实测 dsh 在只读模式下不为 MCP 工具发权限请求，所以对 dsh 这一层的实际作用是拒绝自带工具的提权 |

用户自己在 Agent 里配置的其他 MCP 服务不在 Pith 的控制之内：它们运行在 Agent 进程之外时，宿主沙盒也管不到。Pith 不声称能约束它们。

### 2.5 工具表（[`tools.ts`](../../src/plugins/guide-acp/tools.ts)）

读取：

| 工具 | 作用 |
| :--- | :--- |
| `pith_list_material` | 列出一份材料的文件；仓库材料分页列出绑定提交里的普通文件路径（不含符号链接与未提交的改动） |
| `pith_read_material` | 读材料的一段。仓库材料按行区间读绑定提交里的 UTF-8 文件；其余材料经 `stage.reader` 服务取带坐标的文本块，所以 EPUB、PDF 与字幕都能读。单次返回有界，并指出是否截断 |
| `pith_read_lesson` | 读本课题的一份讲义 |
| `pith_search_material` | 在一份仓库材料的绑定提交里搜索文本，返回 `path:line` 与该行内容。默认按字面匹配，可选正则、区分大小写和路径前缀；单次最多 200 条，并指出是否截断 |
| `pith_compare_material` | 比较同一仓库的两个版本：两份都必须是本课题引用的仓库材料，且 `externalPath` 相同。不带路径时分页列出变化的文件，带路径时返回这个文件的差异。只在课题作用域可用 |
| `pith_search_media` | 按关键词搜索公开音视频（宿主提供 `mediaCorpus` 时才有） |

写入：

| 工具 | 作用 | 结果（`TurnEffect`） |
| :--- | :--- | :--- |
| `pith_create_topic` | 创建课题：标题、目标、引用的材料、训练工具。只在立项作用域可用，一个回合一次；成功后本回合的作用域变为这个课题 | `topic` |
| `pith_write_lesson` | 写入或覆盖本课题的一份讲义；这一讲依据的版本由 Pith 记下（[1-core-store-engine.md](1-core-store-engine.md) 不变量 11） | `lesson` |
| `pith_rebase_lesson` | 确认一份已有讲义不受新版本影响：把它依据的版本改为本课题各仓库的最新版本，不改内容 | `lesson` |
| `pith_save_note` | 向本课题追加一条记录，可带锚点与向导批注。记录的作者是 `guide` | `note` |
| `pith_configure_toolkits` | 把本课题的训练工具设为给定列表 | `toolkits` |
| `pith_ingest_external` | 抓取一个公开网页或讨论，导入为材料；在课题作用域下同时引用它 | `material` |
| `pith_fetch_media_corpus` | 拉取公开音视频与字幕，导入为材料并引用，挂载 `shadowing`，把切片导读写成讲义（宿主提供 `mediaCorpus` 时才有） | `material` |
| `pith_offer_choices` | 给出本回合的下一步选项 | 无 |
| `pith_settle_topic` | 结题：写入《核心认知总结》（作者是 `guide`），把课题置为 `settled`，可同时追加和撤回观察 | `topic`，每条新增观察各一个 `observation` |

规则：

- 立项作用域下，在 `pith_create_topic` 成功之前只有三个写入工具可用：两个导入工具（此时只把内容导入材料库，不引用、不挂工具、不写讲义）与 `pith_offer_choices`。其余写入工具被拒绝，原因是「先创建课题」。
- `pith_ingest_external` 拒绝 GitHub 仓库地址（[1-core-store-engine.md](1-core-store-engine.md) 3.6），原因是「代码仓库请用户从立项框或添加材料导入」。克隆会联网并占用磁盘，只由用户发起。
- `pith_settle_topic` 的门禁：课题处于 `exploring`，至少有一条作者是 `user` 的笔记或实训记录，`verificationSummary` 非空。向导自己写的记录不算。
- 画像只有 `pith_settle_topic` 一个写入口。它只增删观察条目，每条新增在对话里留下一行可撤销的记录；新增观察引用的证据笔记必须是本课题里作者为 `user` 的记录。没有在课题进行中写画像的工具，提交整篇画像的参数也不存在。「什么时候该结题」是写给模型的规则；程序保证的是上面这道门禁，以及写入只发生在这一个工具里。
- 工具失败时把原因作为工具结果返回给模型，由它决定下一步；回合不因此中止。

### 2.6 期限、停止与重新请求

| 请求 | 期限 |
| :--- | :--- |
| 握手（`initialize`、`session/new`、配置项） | 各 60 秒（[`AGENT_HANDSHAKE_TIMEOUT_MS`](../../src/plugins/guide-acp/acpSession.ts)） |
| 前台回合的 `session/prompt` | 不设期限，用户用停止按钮结束 |
| 后台一次性请求：下一步行动、行间翻译、复述要点与对照 | `guide-acp` 设置里的 `timeoutMs`（默认 300 秒，范围 5 到 600 秒） |

后台一次性请求经 `guide.prompt` 服务发出：一段提示词进，一段文本出，不挂工具端点，不带画像与对话。其他插件（`toolkit-interline`、`toolkit-feynman`）通过这个服务使用本机 Agent，不导入 `guide-acp`。

```ts
// src/core/seams.ts
export interface AgentPromptService {
  /** One prompt to the configured local agent, without tools or workspace context. Rejects when no agent is available. */
  prompt(text: string, options?: { readonly signal?: AbortSignal }): Promise<string>;
}
```

**下一步行动**（后台任务 `prepare-next-action`）也走这条通道，不是一个回合，不进对话：提示词由课题目标、已有讲义的文件名和最近 5 条记录组成，要求只返回一个 15 分钟内能完成的具体行动；返回的文本去掉首尾空白后写入 `nextAction`，为空则任务失败。

- **停止**：发送 `session/cancel`，等这次 `session/prompt` 返回，最多 5 秒，然后关闭进程。回合以 `stopped` 结算，已经收到的步骤和已经生效的写入都保留。停止时还在进行的工具调用按工具端点上的事实结算：写入类工具一旦开始落盘就做完，记为完成并带上结果；还没开始落盘的不再执行，记为失败，原因是已停止。Agent 在停止后补发的失败更新不改变这个结果。
- **失败**：进程退出、协议错误或握手超时，回合以 `failed` 结算，`error` 是原始原因。用户消息保留。
- **重新请求**：对 `failed` 或 `stopped` 的回合，用同一条用户消息再跑一次，替换原回合，不产生第二条用户消息。

### 2.7 快捷动作（[`quickActionsForTopic`](../../src/plugins/guide-acp/index.ts)）

向导栏在没有选项可显示时给出快捷动作：

- 课题还没有讲义：`规划课程大纲与第一讲`。
- 已有讲义：`导读这一节`、`下一讲 / 考考我`。
- 课题至少有一条作者是 `user` 的笔记或实训记录：`总结沉淀`。
- 已挂载的训练工具各自贡献的动作。

---

## 3. 神经语音伴读与按需本机网关（`speech-service` & `speechRuntime.ts`）

1. **只读正文，两个位置解耦**：[`filterProseOnly`](../../src/plugins/speech-service/index.ts) 只提取 `isProse === true` 的块朗读；听读期间手动翻页不中断播放，底部播放条提供 `[跳回朗读处]`。
2. **Vault 外的本机语音守护进程（[`NodeManagedSpeechRuntime`](../../src/shells/speech/speechRuntime.ts)）**：
   - 模型与运行时安装在 Vault 之外的系统目录（默认路径与 `PITH_SPEECH_HOME` 规则见 [`NodeManagedSpeechRuntime`](../../src/shells/speech/speechRuntime.ts)），支持下载进度、断点续传、SHA-256 校验与取消；
   - 默认 TTS 为 ZipVoice INT8（中英双语），用预置参考音色（[`ZIPVOICE_PRESETS`](../../src/shells/speech/speechVoices.ts)）与 8 步生成，ASR 为 SenseVoice INT8（多语种）；运行时、模型下载地址及哈希由 [`SPEECH_MODEL_ASSETS`](../../src/shells/speech/speechRuntime.ts) 定义，设置面板提供本机与云端音色选择，运行时不调用宿主机的 `python3` 或 `pip`。

---

## 4. 宿主壳（`src/shells/`）

同一套 `src/core/`、`src/plugins/` 与 `src/workbench/` 经 [`HostPort`](../../src/core/host.ts) 适配三种宿主：

| 宿主壳 | 入口 | 适配职责 |
| :--- | :--- | :--- |
| **Obsidian 插件壳** | [`src/shells/obsidian/index.ts`](../../src/shells/obsidian/index.ts) | 把 `Vault.adapter` 映射为 `WorkspaceStoragePort`，注入仓库只读检视、Agent 进程与工具端点，挂载统一工作台视图，接入系统钥匙串 |
| **独立 Web 桌面壳** | [`src/shells/web/cli.ts`](../../src/shells/web/cli.ts)<br>[`src/shells/web/server.ts`](../../src/shells/web/server.ts) | 基于 Node 文件系统与本地 HTTP 服务（默认 `http://127.0.0.1:4173`）挂载同一份工作台；回合进度经服务端推送送到浏览器 |
| **DSH 宿主壳** | [`src/shells/dsh/index.ts`](../../src/shells/dsh/index.ts) | 导出统一工作台视图与 [`createDshPluginBundle`](../../src/shells/dsh/index.ts)。后者的工具由 2.5 的同一工厂生成，只多一个必填的 `topicId` 来确定作用域；不另行定义工具 |

`ToolServerPort` 的两个实现都在 `src/shells/` 下，监听回环地址上的随机端口。

---

## 5. 验证命令

```bash
npm run test:file -- tests/wave3-track2-guide-tools.test.ts tests/track1-guide-providers.test.ts tests/task15-speech-runtime.test.ts tests/wave2-trackB-shells.test.ts
```
