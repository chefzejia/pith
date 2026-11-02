# Pith · 空间秩序、语音引擎选型纠偏与 Obsidian 真机打磨交接单（HANDOFF · Wave 6）

> **仓库路径**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **必读最新契约**：[`AGENTS.md`](../AGENTS.md) · [`docs/003-interaction.md`](003-interaction.md)
> **参考母本**：
> - [`/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/styles.css`](/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/styles.css)
> - [`/Users/zejiawu/Projects/Project-Atlas/ganfan-audio/README.md`](/Users/zejiawu/Projects/Project-Atlas/ganfan-audio/README.md)（本机语音资产说明）

---

## 🛑 最高优先级死命令：严禁偏离目标用 `Qwen3-TTS` 或系统语音取巧凑数！

用户明确批评并立下铁律：
1. **绝对禁止在任何测试、验证或脚本中使用 `ganfan-audio/models/Qwen3-TTS-12Hz-0.6B-Base`（或 `venvs/qwen3tts`）以及 macOS 系统语音（`say` / `SiriTTS` / `speechSynthesis`）来冒充 TTS 验收！**
   - `ganfan-audio/README.md` 已明文规定：`Qwen3-TTS` 仅是废弃的 `bench/` 对比残余，**极其消耗内存且音质差，严禁触碰或启动**！
   - 更不允许为了凑“180 秒慢速本地推理”去把 `neuralSpeech.ts` 的超时改大来迁就 `Qwen3-TTS`！
2. **Pith 语音伴读（TTS）的真实选型与验收准则**：
   - 在本机已有资产中，用户唯一认可的高品质克隆模型是 **`IndexTTS-2.5`**（位于 `/Users/zejiawu/Projects/Project-Atlas/ganfan-audio/models/IndexTeam/IndexTTS-2.5` + `venvs/indextts25`，专为视频成片按需单次克隆设计）；而针对**实时交互式阅读伴读（低延迟、极小内存占用）**，我们的架构选型是：
     1. **`kokoro-local`**（轻量开源 82M 实时 TTS 引擎，标准 OpenAI `/v1/audio/speech` 协议，待用户按需拉起或使用标准轻量兼容服务）；
     2. **`indextts-local`**（或本机 OpenAI `/v1/audio/speech` 兼容的 `IndexTTS-2.5` 封装端点，**绝不用 Qwen3-TTS**）；
     3. **`openai-tts` / `azure-neural`**（云端实时低延迟神经网络语音）。
   - **严禁取巧原则**：如果本机当前尚未安装/启动 `Kokoro-82M`，**绝对不要去翻箱倒柜找 `Qwen3-TTS` 硬凑一个慢吞吞的本地服务来假装通过验收**！
     - 正确的做法是：① 验证未启动引擎时的严格 **Fail-Closed 轻量提示**；② 使用轻量可控的契约替身（或按需用 `IndexTTS-2.5` 单次预生成的真实自然人声 `.wav` 样本 / 已配置的云端 API）验证前端 `<audio>` 连续播放、句级高亮跟随（`.pith-speech-active`）、预取与顶栏播控条交互，并如实向用户报告“Kokoro-82M 待您决定是否在本机下载安装”，**绝不自作主张拉起 Qwen 模型占满用户内存**！

---

## 🚨 本轮必须 100% 根治的 5 大核心问题

### 1. Obsidian Vault 顶层命名空间隔离（默认收纳进 `Pith/` 目录，绝不污染 Vault 根目录！）
- **问题**：此前 `PithObsidianPlugin` 调用 `createObsidianHostPort(this.app.vault.adapter, "")` 将 `workspacePath` 设为了空字符串 `""`，导致 `_cache`、`materials`、`topics`、`ME.md` 直接散落在用户 Vault 根目录下！
- **修正要求**：
  - 在 `src/shells/obsidian/index.ts` 中，将 `createObsidianHostPort` 的默认 `workspacePath` 改为 **`"Pith"`**（并在 `PithObsidianPlugin.onload()` 中默认使用 `"Pith"`，同时支持在 `PithSettingTab` 中配置 `workspacePath`，自动确保 `Pith/` 目录存在）；
  - 所有 Pith 数据在 Obsidian Vault 中默认整齐收纳于 **`Pith/ME.md`**、**`Pith/topics/`**、**`Pith/materials/`**、**`Pith/_cache/`** 下！

### 2. 打开 Pith 时自动折叠 Obsidian 原生左侧文件树边栏
- **问题**：打开 Pith 后，Obsidian 左侧原生文件树侧边栏仍然敞开着，占掉近 300px 宽度。
- **修正要求**：
  - 在 `PithObsidianPlugin.openView()` 及 `PithWorkspaceView.onOpen()` 中，自动检测并调用 `(this.app.workspace as { leftSplit?: { collapse?: () => void } }).leftSplit?.collapse?.()`，在打开 Pith 时自动收起 Obsidian 原生左侧边栏！

### 3. 彻底废除遮挡正文视线的「底部半透明悬浮条」，将 `[🎧 听读]` 与 `[Aa 排版]` 统一收拢进 44px 极简顶栏！
- **问题**：此前底部半透明（`opacity: 0.15`）的 `.pith-bottom-dock` 直接压在书籍正文文字（如“作者 / 译者”）上方，既像一块擦不干净的水印挡住视线，又破坏了阅读的纯粹感；同时顶栏上直接裸露了两个生硬的原生 `<select>` 下拉框（`Aa 中`、`滚动`）。
- **修正要求（严格对齐 [`docs/003-interaction.md`](003-interaction.md)）**：
  - **彻底移除正文底部的半透明悬浮遮挡设计**，将所有控制统一收拢进 **44px 极简顶栏（Top Bar）**：
    `[☰] [‹]  书名 · 当前章节                      (按需实训胶囊)  [🎧]  [Aa]  [◨]`
  - **`[🎧]`（顶栏听读按钮 + 紧贴顶栏的轻量播控条）**：
    - 平时在顶栏右侧展示干净的 `[🎧]` 听读按钮（`#read-aloud` / `[data-command="read"]`）；
    - 点击开启朗读时，在顶栏内联或紧贴顶栏正下方展开轻量播控条（显示 `[⏸ 暂停 · 1.0x · ✕]`），属于外框 Chrome，**100% 绝不压在正文字上**！
  - **`[Aa]`（精致排版弹出气泡菜单，消灭裸露的原生 `<select>`）**：
    - 顶栏右侧用干净的 `[Aa]` 按钮替代裸露的下拉框；点击 `[Aa]` 在下方弹出精致圆角气泡卡片（`.pith-typography-popover`），内部分段切换 **字号（`小 15px` | `标准 17px` | `大 20px`）** 与 **版式（`流式滚动` | `双页分页`）**（注：如现有单测依赖 `select.pith-page-mode` 或 `#page-mode`、`.pith-bottom-dock`、`#open-dojo` 选择器，可将它们放在 `[Aa]` 弹出气泡卡片或顶栏工具容器内并保持选择器兼容，但**绝对禁止在正文底部区域放置任何遮挡文字的半透明悬浮层**！）。

### 4. 右侧向导侧栏（Guide Sidebar）：进入阅读页时默认收起，100% 让位主视觉！
- **问题**：点进一本书开始阅读时，右侧向导侧栏默认占着 320px~340px 宽度，挤压了书籍阅读空间。
- **修正要求**：
  - **当用户从罗盘首页进入课题阅读页（`openTopic`）时，右侧向导栏默认处于收起状态（`guideVisible = false`，右侧占 0px，主阅读舞台 100% 居中撑满）**！
  - 只有当用户**主动点击右上角 `[◨]` 向导图标**，或者在正文中**框选文字点击「💬 问向导」**时，右侧向导栏才平滑展开；且一旦用户在当前课题手动切换了开关状态，记住用户的偏好，不在同课题切换章节时乱跳。

### 5. 测试环境卫生死命令：唯一固定使用 `/Users/zejiawu/Projects/Project-Atlas/labs/pith/.dev-vault`，严禁新建垃圾空 Vault！
- **绝对红线（必读！）**：
  1. **严禁触碰用户的正常 Obsidian Vault**：绝对禁止修改、删除或操作 `/Users/zejiawu/Library/Mobile Documents/iCloud~md~obsidian/Documents/ganfan-media` 以及 `/Users/zejiawu/Downloads` 等任何用户目录！
  2. **清理历史临时垃圾空 Vault**：检查 `~/Library/Application Support/obsidian/obsidian.json`，如果里面有此前测试自动注册的指向 `/tmp/...` 或 `/var/folders/...` 的临时空测试 Vault 条目，将其从 `obsidian.json` 中安全移除（**切勿移除 `ganfan-media` 和 `Downloads`！**），并删除 `/tmp` 下对应的临时空测试 Vault 文件夹。
  3. **全项目唯一固定开发测试 Vault**：
     - 固定路径：**`/Users/zejiawu/Projects/Project-Atlas/labs/pith/.dev-vault`**（已加入 `.gitignore`）；
     - 所有 Obsidian 真机部署与 CUA 验收，**永远只复用这一个 `.dev-vault`**（将 `dist/obsidian/{main.js,manifest.json,styles.css}` 复制到 `.dev-vault/.obsidian/plugins/pith/`，测试材料和课题统一放在 `.dev-vault/Pith/` 顶层目录下）。

---

## 📦 执行与验收清单（由 ChatGPT App 常驻总控调度 Worker + CUA Tester 闭环）

1. **回退针对 `Qwen3-TTS` 慢模型的取巧超时改动 & 完成 Wave 6 UI 改造**：
   - 移除为迁就慢速 `Qwen3-TTS` 而添加的 30 秒慢等待单测（`tests/neural-speech-timeout.test.ts` 中耗时 30 秒的用例会导致每次 `npm test` 变慢 30 秒！测试应使用毫秒级可控时钟或短超时），保持 `npm test` 在数秒内快速跑完；
   - 完成上述 1~5 项修改，运行 `npm run typecheck`、`npm test` 与 `npm run build:obsidian` 确保 100% 通过。
2. **固定 `.dev-vault` 部署与 Obsidian 真机 CUA 验收（严禁启动 `Qwen3-TTS`！）**：
   - 将最新构建产物部署到唯一固定的 `/Users/zejiawu/Projects/Project-Atlas/labs/pith/.dev-vault/.obsidian/plugins/pith/`；
   - 使用 CUA 打开真实 Obsidian（指向 `.dev-vault`），实测并截图验证：
     - [ ] 打开 Pith 时，Obsidian 原生左侧文件树自动收起；若展开左侧文件树查看，所有 Pith 文件均整齐收纳在顶层 **`Pith/`** 文件夹下（绝不散落在根目录）；
     - [ ] 进入《你的灯亮着吗？》电子书阅读页时，**右侧向导栏默认收起**，正文居中撑满，霞鹜文楷排版与封面插图清晰；
     - [ ] **正文底部 100% 干净无任何半透明遮挡物**！听读开关 `[🎧]`、排版菜单 `[Aa]`、向导开关 `[◨]` 全部规整在 44px 极简顶栏中；
     - [ ] 点击 `[Aa]` 弹出排版气泡切换字号与双栏分页正常；框选文字点击「问向导」自动展开右侧向导栏。
   - 验收通过后将代码变更 `git commit` 入库并向用户展示真机截图。
