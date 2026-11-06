# 子系统 4：标准 ACP 向导、按需语音与多态宿主壳（`guide-acp` · `speech-service` · `shells`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [3-dojos.md](3-dojos.md)

---

## 1. 为什么有这一层（职责与边界）

对应人类认知训练管线的 **第 2 阶段：SFT（因人施教向导）**、**第 4 阶段：Eval（结题门禁）**、**篇幅级神经语音伴读基础设施**，以及将这些能力适配到不同原生运行环境的**多态宿主壳**。

```text
src/
├── plugins/
│   ├── guide-acp/                # 标准 ACP 向导插件（提供服务 "guide.agent"）
│   │   ├── index.ts              # 场景提示词拼装（buildScenePrompt）、快捷动作与插件注册
│   │   ├── discovery.ts          # 本机 ACP Agent（dsh / claude / codex）可执行文件发现与版本探测
│   │   ├── acpSession.ts         # 标准 JSON-RPC 2.0 stdio 会话、configOptions 探测与工具调用循环
│   │   ├── tools.ts              # 7 个受控工作区工具（pith_get_context ... pith_settle_topic）
│   │   └── externalIngest.ts     # SSRF 防护公网 URL 抓取与文章/讨论/媒体打包导入
│   └── speech-service/           # 语音伴读与转写插件（提供服务 "speech.tts" & "speech.asr"）
│       ├── index.ts              # 句子切分（Intl.Segmenter）、正文过滤（filterProseOnly）与朗读会话游标
│       └── neuralSpeech.ts       # OpenAI/Azure/本地兼容 HTTP 语音合成、预取队列（PrefetchSpeechQueue）与 ASR
└── shells/                       # 多态原生宿主壳（唯一允许导入 node:* / "obsidian" / @deepseek-ai/* 的外层）
    ├── obsidian/                 # Obsidian 桌面插件壳（index.ts 宿主桥接 + plugin.ts 视图渲染）
    ├── web/                      # 独立 Web 桌面壳（cli.ts / server.ts / nodeStorage.ts / nodeProcess.ts）
    ├── dsh/                      # DeepSeek Harness 工具包壳（index.ts 导出 DshTool[] 与公网 DNS 校验器）
    ├── speechRuntime.ts          # NodeManagedSpeechRuntime（Vault 外本机 sherpa-onnx 按需守护进程管理）
    ├── speechGateway.ts          # 内嵌回环 HTTP 语音网关脚本（Kokoro-82M v1.1-zh + SenseVoice）
    └── interline.ts / interlineView.ts / toolkitSlot.ts / speechSettings.ts / acpSettings.ts
```

---

## 2. 标准 ACP 向导协同与结题硬门禁（`guide-acp`）

### 2.1 100% 标准 ACP 协议交互（零私有配置硬编码）

[`LocalAcpGuideProvider`](../../src/plugins/guide-acp/acpSession.ts) 通过 JSON-RPC 2.0 over stdio 驱动本机 Agent（`dsh --profile acp`、`claude-agent-acp`、`codex-acp`）：

1. **动态模型与推理强度发现（[`probeAgentOptions`](../../src/plugins/guide-acp/acpSession.ts)）**：
   - 执行 `initialize` + `session/new`，直接从返回的 `result.configOptions` 解析模型树（`id: "model"`）与推理强度选项（`id: "reasoning_effort" | "effort"`），归一化为 [`AcpConfigOptionDescriptor[]`](../../src/core/seams.ts)；
   - 切换模型或推理强度时统一调用标准 `session/set_config_option`，**严禁读取 `~/.dsh/` 等任何特定 Agent 的私有配置文件**。
2. **只读文件沙盒与受控工具网关（[`createGuidePermissionGate`](../../src/plugins/guide-acp/acpSession.ts)）**：
   - 向导子进程启动时注入只读权限环境（[`buildReadOnlyAgentEnv`](../../src/plugins/guide-acp/acpSession.ts)），并拦截越界的宿主文件写请求（`fs/write_text_file`、终端执行等一律拒绝）；
   - 向导对工作区的所有修改必须通过 [`createGuideWorkspaceTools`](../../src/plugins/guide-acp/tools.ts) 暴露的 7 个强校验工具完成：`pith_ingest_external`、`pith_get_context`、`pith_read_material_section`、`pith_save_note`、`pith_write_lesson`、`pith_configure_toolkits`、`pith_settle_topic`。
3. **结题毕业硬门禁（[`pith_settle_topic`](../../src/plugins/guide-acp/tools.ts)）**：
   - 仅当课题处于 `status === "exploring"` **且已存在至少一条学习者笔记/实训记录（`topic.notes.length > 0`）** 时，才允许追加 `## 核心认知总结` 并将课题置为 `settled`；空笔记课题调用结题直接抛错拒绝。

---

## 3. 篇幅级神经语音伴读与按需本机网关（`speech-service` & `speechRuntime.ts`）

### 3.1 纯正文句级游标与滑动预取

1. **非正文严格剔除（[`filterProseOnly`](../../src/plugins/speech-service/index.ts)）**：仅提取 `isProse === true` 的块，通过 `Intl.Segmenter` 按句切分并生成带句内偏移的定位符 `locator;offset:<n>`；点击代码块、公式或表格触发伴读时直接返回 `{ started: false, reason: "not-prose", tip: "此处非正文段落，无法伴读" }`。
2. **双缓冲预取队列（[`PrefetchSpeechQueue`](../../src/plugins/speech-service/neuralSpeech.ts)）**：播放当前句时后台并发预取后续句子的音频字节，消除句间网络/合成停顿；暂停或停止时通过 `AbortSignal` 立即取消在途请求，且在 `play()` 异步启动尚未落定前锁定暂停按钮防止竞态报错。

### 3.2 零 Python 依赖的 Vault 外本机语音守护进程（[`NodeManagedSpeechRuntime`](../../src/shells/speechRuntime.ts)）

1. **安装位置与安全隔离**：
   - 模型与运行时安装在 Vault 之外的系统应用目录（macOS 默认为 `~/Library/Application Support/pith/speech/managed-v2`，可通过环境变量 `PITH_SPEECH_HOME` 指定绝对路径）；
   - [`checkPath`](../../src/shells/speechRuntime.ts) 强制校验安装路径不在 Vault 或工作区内部且非符号链接，卸载（`remove`）前校验 `.owner === "pith-managed-speech-v2"` 标记文件，防止误删用户目录。
2. **原生模型资产（SHA-256 强校验，零 Python / 零 `pip`）**：
   - **运行时**：预编译 `node` + `sherpa-onnx-node` 原生绑定；
   - **TTS 模型**：`kokoro-int8-multi-lang-v1_1.tar.bz2`（`Kokoro-82M v1.1-zh` 中英双语 int8 量化模型，含中英词典与中文日期/数字/电话 `.fst` 规则）；
   - **ASR 模型**：`sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2`（`SenseVoice` 中英日韩粤多语种 int8 模型）。
3. **按需拉起与空闲回收**：
   - 在 `local` 语音模式下点击听读或录音转写时，自动调用 `ensureRunning()` 拉起 [`SPEECH_GATEWAY`](../../src/shells/speechGateway.ts) 本机回环 HTTP 服务（监听 `127.0.0.1` 随机端口，暴露 `/health`、`POST /v1/audio/speech`、`POST /v1/audio/transcriptions`）；
   - 连续 `180 秒`（`idleTimeoutSec`）无请求或宿主关闭时，子进程自动退出释放内存。

---

## 4. 多态原生宿主壳（`src/shells/`）

同一套 `src/core/` 与 `src/plugins/` 通过 [`HostPort`](../../src/core/host.ts) 适配三种宿主环境：

| 宿主壳 | 入口文件 | 核心适配职责 |
| :--- | :--- | :--- |
| **Obsidian 插件壳** | [`src/shells/obsidian/index.ts`](../../src/shells/obsidian/index.ts)<br>[`src/shells/obsidian/plugin.ts`](../../src/shells/obsidian/plugin.ts) | 将 Obsidian `Vault.adapter` 映射为 `WorkspaceStoragePort`（默认根目录 `Pith/`），接入系统钥匙串 `secretStorage`，注册 `PithObsidianView` 叶子视图与设置面板。 |
| **独立 Web 桌面壳** | [`src/shells/web/cli.ts`](../../src/shells/web/cli.ts)<br>[`src/shells/web/server.ts`](../../src/shells/web/server.ts) | 基于 Node 文件系统（[`NodeWorkspaceStorage`](../../src/shells/web/nodeStorage.ts)）与本地 HTTP 服务（默认 `http://127.0.0.1:4173`）提供完整桌面阅读、实训、向导与语音工作台。 |
| **DSH 工具包壳** | [`src/shells/dsh/index.ts`](../../src/shells/dsh/index.ts) | [`createDshPluginBundle`](../../src/shells/dsh/index.ts) 将罗盘、课题读写、讲义生成、外部导入（含防 DNS 重绑定的 [`DshPublicHttpPort`](../../src/shells/dsh/index.ts)）封装为标准 `DshTool[]` 供 Super Agent 直接调用。 |

---

## 5. 验证命令

```bash
node --experimental-strip-types --test tests/guide-acp.test.ts tests/track1-guide-providers.test.ts tests/speech.test.ts tests/task15-speech-runtime.test.ts tests/shells.test.ts
```
