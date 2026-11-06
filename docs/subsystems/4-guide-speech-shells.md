# 子系统 4：标准 ACP 向导、按需语音与多态宿主壳（`guide-acp` · `speech-service` · `shells`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [3-dojos.md](3-dojos.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 职责与边界

对应人类认知训练管线的 **第 2 阶段：SFT（因人施教向导 [`guide-acp`](../../src/plugins/guide-acp/index.ts)）**、**第 4 阶段：Eval（结题门禁与权重合并 [`pith_settle_topic`](../../src/plugins/guide-acp/tools.ts)）**、**篇幅级神经语音伴读基础设施（[`speech-service`](../../src/plugins/speech-service/index.ts) & [`shells/speech`](../../src/shells/speech/index.ts)）**，以及将统一工作台与宿主能力适配到不同原生运行环境的**多态宿主薄壳（[`src/shells/`](../../src/shells/)）**（全平台工作台与空间槽位规范见 [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)）。

---

## 2. 标准 ACP 向导协同、三种课程模式与结构化围栏协议（`guide-acp`）

### 2.1 三类课题的因人施教策略（[`buildScenePrompt`](../../src/plugins/guide-acp/index.ts)）

向导在每次对话前自动聚合 `<workspace>/ME.md`（已知基座与擅长类比）、当前 `Topic` 元数据、历史 `notes` 账本以及当前选区 `SelectionAnchor`，针对三类课题采取不同策略：
1. **无现成教材的认知/架构型课题（如啃开源仓库、新理论）**：结合 `ME.md` 锁定唯一主线问题，通过 `pith_write_lesson` 生成《课程大纲》与带源码/出处引用的单课讲义（写入 `materials/<id>/files/` 供左侧舞台精读与划重点）；
2. **已有现成原著/论文/播客的伴读型课题**：不重写原书、不做替代原著的速食摘要；协助学习者拆解卡壳段落，并按需注入 `interline` 或 `feynman` 工具；
3. **需要具身反馈的技能型课题（如外语口语跟读）**：动态注入 `shadowing` 等实训工具，结合学习者带回的 `practice` 漏词/盲区记录迭代下一步 15 分钟微动作（`nextAction`）。

### 2.2 动态快捷胶囊槽（[`quickActionsForTopic`](../../src/plugins/guide-acp/index.ts)）

向导侧栏顶部的快捷胶囊区采用**「基础场景槽 + 已挂载 Dojo 贡献槽」**动态合成，严禁硬编码全量死按钮：
- **基础场景槽**：默认提供 `导读这一节`、`考考我 / 下一步`；仅当课题已存在至少一条学习者笔记（`topic.notes.length > 0`）时，才解锁显示 **`总结沉淀`** 毕业胶囊；
- **Dojo 贡献槽**：遍历当前课题 `topic.toolkits` 中已激活的 Dojo 插件，动态合并其 `dojo.quickActions`（如 `shadowing` 注入 `分析跟读`，`feynman` 注入 `费曼深水区追问`）。

### 2.3 三种尾部结构化围栏协议（Trailing Directives）

为保持自然语言对话干净且无需复杂前端表单，向导回复通过三种尾部代码块围栏驱动前端胶囊与工作区变更：
1. **可点击选项胶囊（````pith-choices````）**：由 [`parseGuideReply`](../../src/core/engine/AttentionEngine.ts) 解析回复末尾的列表或 JSON 数组，在消息气泡下方渲染为点按即发的选项胶囊按钮；
2. **工具包动态编排（````pith-toolkits````）**：由 [`parseToolkitDirective`](../../src/plugins/guide-acp/acpSession.ts) 解析回复末尾的 JSON 字符串数组（如 `["interline", "feynman"]`），自动调用 `pith_configure_toolkits` 更新 `topic.toolkits`；
3. **受控工作区工具调用（````pith-tool````）**：由 [`LocalAcpGuideProvider.reply`](../../src/plugins/guide-acp/acpSession.ts) 解析末尾的单行 JSON `{"name":"...","arguments":{...}}`，经会话作用域校验（禁止跨课题/跨材料越权访问）后执行。

### 2.4 100% 标准 ACP 协议与 7 个受控工具（[`tools.ts`](../../src/plugins/guide-acp/tools.ts)）

1. **动态模型与推理强度发现（[`probeAgentOptions`](../../src/plugins/guide-acp/acpSession.ts)）**：通过 `initialize` + `session/new` 读取 `result.configOptions`，并通过 `session/set_config_option` 切换，严禁读取特定 Agent 的私有配置文件。
2. **只读沙盒与受控工具表**：向导子进程以只读权限启动（[`buildReadOnlyAgentEnv`](../../src/plugins/guide-acp/acpSession.ts)），所有工作区写操作仅能通过以下 7 个工具执行：

| 工具名称 | 核心职责与安全门禁 |
| :--- | :--- |
| `pith_ingest_external` | 经 SSRF 公网 IP 校验（[`isPublicHttpUrl`](../../src/plugins/guide-acp/externalIngest.ts)）抓取外部文章/讨论/媒体并导入为只读 `Material` |
| `pith_get_context` | 读取 `ME.md`、课题看板快照与指定 `Topic` 详情 |
| `pith_read_material_section` | 按 `text:line:<N>` 有界读取文本材料上下文窗口（前后限定行数，防上下文撑爆） |
| `pith_save_note` | 向当前课题追加 `note`、`highlight` 或 `practice` 记录及向导评注 `guideRemark` |
| `pith_write_lesson` | 在材料包下生成新的 `.md` 课程讲义（严禁覆盖已有的原始导入文件） |
| `pith_configure_toolkits` | 校验并更新当前课题挂载的 `topic.toolkits` |
| `pith_settle_topic` | **硬性毕业门禁**：校验 `status === "exploring"` 且 `topic.notes.length > 0`，追加 `## 核心认知总结`、将课题置为 `settled` 并支持反哺更新 `ME.md` |

---

## 3. 篇幅级神经语音伴读与按需本机网关（`speech-service` & `speechRuntime.ts`）

### 3.1 纯正文句级游标、双位置解耦与滑动预取

1. **非正文严格剔除（[`filterProseOnly`](../../src/plugins/speech-service/index.ts)）**：仅提取 `isProse === true` 的块，通过 `Intl.Segmenter` 按句切分并生成带句内偏移的定位符 `locator;offset:<n>`；点击代码块、公式或表格触发伴读时直接返回 `{ started: false, reason: "not-prose", tip: "此处非正文段落，无法伴读" }`。
2. **视线位置与朗读位置解耦（`readingLocator` vs `speechLocator`）**：
   - 正常听读时，正文通过 `.pith-speech-active` 高亮当前朗读句，跨屏时自动翻页；
   - 用户在听读期间手动翻页浏览前后文时，听读不中断，底部播客甲板提供 **`[跳回朗读处]`** 按钮一键将视口拉回当前朗读句。
3. **双缓冲预取队列（[`PrefetchSpeechQueue`](../../src/plugins/speech-service/neuralSpeech.ts)）**：播放当前句时后台并发预取后续句子的音频字节，消除句间停顿；暂停或停止时通过 `AbortSignal` 立即取消在途请求，且在 `play()` 异步启动尚未落定前锁定暂停按钮防止竞态报错。

### 3.2 零 Python 依赖的 Vault 外本机语音守护进程（[`NodeManagedSpeechRuntime`](../../src/shells/speech/speechRuntime.ts)）

1. **安装位置与安全隔离**：
   - 模型与运行时安装在 Vault 之外的系统应用目录（默认路径与 `PITH_SPEECH_HOME` 环境变量规则见 [`NodeManagedSpeechRuntime`](../../src/shells/speech/speechRuntime.ts)）；
   - [`checkPath`](../../src/shells/speech/speechRuntime.ts) 强制校验安装路径不在 Vault 或工作区内部且非符号链接，卸载（`remove`）前校验 `.owner` 标记文件，防止误删用户目录。
2. **原生模型资产（SHA-256 强校验，零 Python / 零 `pip`）**：
   - 预编译原生推理运行时与多语种 TTS/ASR 模型资产清单、下载地址及哈希校验值由 [`speechRuntime.ts`](../../src/shells/speech/speechRuntime.ts) 中的 `assets` 统一定义，严禁在运行时调用宿主机 `python3` 或 `pip`。
3. **按需拉起与空闲回收**：
   - 在 `local` 语音模式下点击听读或录音转写时，自动调用 `ensureRunning()` 拉起 [`SPEECH_GATEWAY`](../../src/shells/speech/speechGateway.ts) 本机回环 HTTP 服务（监听 `127.0.0.1` 随机端口，暴露 `/health`、`POST /v1/audio/speech`、`POST /v1/audio/transcriptions`）；
   - 超过空闲阈值（`idleTimeoutSec`）无请求或宿主关闭时，子进程自动退出释放内存。

---

## 4. 多态原生宿主薄壳（`src/shells/`）

同一套 `src/core/`、`src/plugins/` 与统一图形工作台 `src/workbench/` 通过 [`HostPort`](../../src/core/host.ts) 适配三种原生宿主环境（全 Shell 100% 共享同一份工作台 UI 与交互）：

| 宿主壳 | 入口文件 | 核心适配职责 |
| :--- | :--- | :--- |
| **Obsidian 插件壳** | [`src/shells/obsidian/index.ts`](../../src/shells/obsidian/index.ts)<br>[`src/shells/obsidian/plugin.ts`](../../src/shells/obsidian/plugin.ts) | 将 Obsidian `Vault.adapter` 映射为 `WorkspaceStoragePort`（默认根目录 `Pith/`），打开时自动收起原生左侧文件树（`leftSplit.collapse()`），挂载统一工作台视图与右侧向导栏（`rightSplit`，进入阅读默认收起），接入系统钥匙串 `secretStorage`。 |
| **独立 Web 桌面壳** | [`src/shells/web/cli.ts`](../../src/shells/web/cli.ts)<br>[`src/shells/web/server.ts`](../../src/shells/web/server.ts) | 基于 Node 文件系统（[`NodeWorkspaceStorage`](../../src/shells/web/nodeStorage.ts)）与本地 HTTP 服务（默认 `http://127.0.0.1:4173`）挂载同一份统一图形工作台。 |
| **DSH 宿主壳** | [`src/shells/dsh/index.ts`](../../src/shells/dsh/index.ts) | 同时导出统一图形工作台视图与 [`createDshPluginBundle`](../../src/shells/dsh/index.ts)（将课题看板、课题读写、讲义生成与含防 DNS 重绑定 [`DshPublicHttpPort`](../../src/shells/dsh/index.ts) 的外部导入封装为标准 `DshTool[]`）。 |

---

## 5. 验证命令

```bash
node --experimental-strip-types --test tests/wave3-track2-guide-tools.test.ts tests/track1-guide-providers.test.ts tests/task15-speech-runtime.test.ts tests/wave2-trackB-shells.test.ts
```
