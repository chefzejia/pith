# Pith · 任务调度板（TASKS Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈与多 Worktree 协同契约（详见 [ROLES.md](ROLES.md) & [PRODUCT.md](PRODUCT.md) & [ARCHITECTURE.md](ARCHITECTURE.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/PRODUCT.md` / `docs/ARCHITECTURE.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（标记 `- **Status**: pending` 与 `- **Scope**: ...`）写入本文件，并执行隔离提交 `git commit --only docs/TASKS.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守战术法官 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒（监听 `HEAD:docs/TASKS.md`），取单先置 `Status: in_progress`（若主目录忙于验收或多任务 `Scope` 正交，则在 `.tmp/worktrees/task-<N>` 开启隔离 Worktree 并行派发 Worker 并在内环单测通过后变基合回 `main` 销毁临时目录），串联调度常驻 Worker（必读 [LESSONS.md](LESSONS.md)、完成全仓测试 + 手动破壁 `Broken by hand` 并在业务 Commit Body 记录意图/根因与验证证据）与独立 Tester（在专用沙盒中模拟真实用户操作与截屏审视，首轮穷尽挑刺）：若 Tester 打回显性问题，由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 顺手固化为 `tests/` 守卫单测）并在执行环内部直接拍板闭环；**每完成一单必须在进入下一单前立即将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附真实业务 `Verified-Commit`）并执行 `git commit --only docs/TASKS.md`；提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #27] 阅读舞台键盘翻页焦点自动接管 & EPUB 深色模式字色可读性修复（对齐 `ganfan-garden` 渲染演进）

- **Status**: verified
- **Scope**: `src/workbench/**`, `src/plugins/stage-reader/**`, `tests/**`
- **Verified-Commit**: 779c063ae931b5157db06a41b05b5e569b8d954d
- **Updated**: 2026-11-08
- **验收摘要**：Tester 在 Web 与隔离 Obsidian 实际导入《女人的性爱动机》沙盒副本，验证看板进书首次方向键直接翻页、输入焦点保护、原书浅黄底章节生效及明暗主题正文对比度（最低 4.54:1，截图 `.tmp/evidence/task-27/final-*.png`）。

---

## [Task #28] 本机语音引擎下载实时进度可视化、断点续传抗超时与取消控制

- **Status**: verified
- **Scope**: `src/shells/speech/**`, `src/workbench/**`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **Verified-Commit**: 852bb9cda7913749f1af9d7a64456fb6d9339aca
- **Updated**: 2026-11-09
- **验收摘要**：独立 Tester 在 Web 与真实隔离 Obsidian（`.dev-vault`）中验证进度多次增长、重开保持、取消后保留已下字节并从 `Range` 续传、五个归档校验解压完成，以及错误哈希显性失败（证据见 `.tmp/evidence/task-28/`）。

---

## [Task #29] 工作区可读短 ID、EPUB OPF 元数据标题净化、书籍封面提取与课题看板（Topic Board）书卷卡片重构

- **Status**: verified
- **Scope**: `src/core/store/**`, `src/plugins/stage-reader/**`, `src/workbench/**`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **Verified-Commit**: 1727939ab10a1d8770ac5cb0354053306defa517
- **Updated**: 2026-11-09
- **验收摘要**：Worker 类型检查、全仓测试与构建通过；独立 Tester 在 Web 与真实隔离 Obsidian 验证 OPF 净化标题、真实封面、短 ID 冲突与旧 UUID 兼容、工具标签和笔记计数、已沉淀书目行及三种封面回退；实际原生窗口 550×850 明暗主题通过。截图：`.tmp/evidence/task-29/final-web-populated.png`、`.tmp/evidence/task-29/final-native-populated-narrow-light.png`、`.tmp/evidence/task-29/final-native-populated-narrow-dark.png`、`.tmp/evidence/task-29/final-web-cover-variants.png`、`.tmp/evidence/task-29/final-native-cover-variants.png`。
- **授权范围**：允许修改 `src/core/store/WorkspaceStore.ts`、`src/plugins/stage-reader/epub.ts`、`src/workbench/compass.ts`、`src/workbench/view.ts`、`src/shells/obsidian/index.ts`、`src/shells/web/client.ts`、`src/shells/web/server.ts` 及 `tests/**`。
- **不在范围内**：严禁添加“SVG 进度圆环（progress ring） / 成就徽章 / 打卡纹理”等任务系统噪音；保持对已有旧长 UUID 目录（如 `topic-8bdc0803...`）的 100% 向后兼容读取。
- **背景与参考代码**：执行环开工前请主动阅读：
  - `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/store/ids.ts` 与 `GardenStore.ts`（日期 + 短 slug/hash 可读文件夹 ID 生成）；
  - `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/material/ingest/epub.ts`（OPF `<dc:title>` 提取与 `findCover` 封面提取逻辑）；
  - `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/docs/product/prototype/interaction.html`（第 158~190 行与 894~954 行：探索中三栏精致卡片 `.topic-card` 含顶部状态与时间、衬线标题、关联材料行、虚线分隔下一步建议、底部笔记计数与 `进入 →`，以及已沉淀 `.grown-list` 紧凑横排列表）。
- **接口与行为契约**：
  1. **告别 36 位冗长 UUID：新建 `Topic` 与 `Material` 采用紧凑可读文件夹 ID（`src/core/store/WorkspaceStore.ts`）**：
     - 参考 `ganfan-garden/src/store/ids.ts`，将默认生成的 `topic-${crypto.randomUUID()}` 与 `material-${crypto.randomUUID()}` 改为紧凑可读的 **`topic-<YYYYMMDD>-<slugOrShortHash>`** 与 **`material-<YYYYMMDD>-<slugOrShortHash>`**（英文提取短小写 ASCII slug 限长 24 字符，中文/非拉丁字符提取 6~7 位稳定 base36 短哈希，冲突时自动追加 `-2, -3` 或 4 位随机后缀，总长度控制在 20 字符左右）；
     - 100% 保持对磁盘上既有 `topic-<uuid>` / `material-<uuid>` 目录的兼容读取。
  2. **解决冗长脏文件名污染标题：优先提取 EPUB OPF `<dc:title>` + 剥离下载站尾巴（`src/plugins/stage-reader/epub.ts` & `obsidian/index.ts` & `web/client.ts`）**：
     - 新增导出辅助函数（如 `cleanMaterialTitle(rawNameOrTitle: string)` 与 EPUB 元数据/封面轻量提取函数 `inspectEpubPackage(bytes: Uint8Array): Promise<{ title?: string; author?: string; coverDataUrl?: string }>`）：
       1. 导入 `.epub` 时，优先从 OPF `<dc:title>` 读取真实书名（若 `<dc:title>` 包含 ` = ` 英文副标题或冗长后缀，主标题取干净的书名）；
       2. 对所有从文件名派生的标题，自动剥离扩展名及尾部的下载源垃圾括号（如 `(z-library.sk, 1lib.sk, z-lib.sk)`、`(Z-Library)`、`[z-lib.org]` 等），将《女人的性爱动机 = Why Women Have Sex ... (z-library.sk, 1lib.sk, z-lib.sk)》净化为干净优雅的 **`女人的性爱动机`**（副标题或原文件名留在材料行）；
       3. 渲染课题看板时，对历史已存课题中仍带有 `(z-library...)` 或 ` = Why Women...` 的超长标题同步应用显示层净化与 `line-clamp: 2` 優雅截断（鼠标悬停 `title` 属性可看全名）。
  3. **书籍封面提取与看板卡片呈现（`src/plugins/stage-reader/epub.ts` & `src/workbench/compass.ts` & `obsidian/index.ts` & `web/server.ts`）**：
     - 参考 `ganfan-garden/src/material/ingest/epub.ts` 的 `findCover`（检查 OPF `<meta name="cover">`、`properties="cover-image"`、`<reference type="cover">` 或首章内嵌封面图），支持从 EPUB（及单图/CBZ 首图）提取封面图片 Data URL / 缩略图 URL 并通过看板材料摘要传给 `renderCompass`；
     - **重构课题看板卡片（`src/workbench/compass.ts` & `view.ts`，对齐 `interaction.html` 原型美感，拒绝死板方框）**：
       - **探索中卡片（`.pith-topic-card`）**：
         - 顶部元信息行（`.pith-card-top`）：左侧鼠尾草绿胶囊标签 `探索中`（若已挂载 `toolkits` 则并列展示轻量工具标签如 `· 行间双语 / 影子跟读`），右侧显示相对/简短更新时间；
         - 主体区：若关联材料有书籍封面（`coverUrl`），在卡片内以精致书封缩略图（如右侧或左侧圆角小书封 `width: 56px; height: 78px; object-fit: cover; border-radius: 4px; box-shadow: ...`）与左侧衬线大标题（`h3`）+ `材料：《...》` 副标题并排呈现；
         - 虚线分隔区（`border-top: 1px dashed ...`）：展示下一步建议（`nextAction` 或 `target`，无则温和提示 `点进材料，框选文字即刻高亮、记笔记或问向导`）；
         - 底部页脚行（`.pith-card-foot`）：左侧显示 `已收 N 条笔记/高亮`（或 `暂无笔记`），右侧显示 `进入阅读 →`；
       - **已沉淀区域（`settled`）**：采用原型中克制优雅的水平书目行列表（`.pith-settled-row`），左侧展示标题与 `材料：... · 共归档 N 条核心笔记`，右侧展示陶土色 `已沉淀` 胶囊。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿（自动同步至 `.dev-vault` 与 `ganfan-media`）；新增单测与浏览器回归测试覆盖：1) 新建课题与材料生成的 ID 为紧凑可读的 `topic-YYYYMMDD-xxx` 格式；2) 含 `(z-library.sk, 1lib.sk, z-lib.sk)` 及 OPF `<dc:title>` + 封面的 EPUB 导入后，看板卡片显示净化后的干净书名、真实封面缩略图 `<img>`（`naturalWidth > 0`）、虚线建议区与底部笔记计数；完成手动破壁验证并截屏存入 `.tmp/evidence/task-29/` 自检。
- **Tester 模拟用户终验要求**：在 Web 与真实隔离 Obsidian 中导入带封面和长文件名的 EPUB，检查文件夹命名长度、看板卡片封面缩略图、干净标题、顶部/底部元信息排版与明暗主题视觉美感，截图归档至 `.tmp/evidence/task-29/`。

---

## [Task #30] Kokoro v1.1-zh 内置 103 个多语种音色动态发现与本机/云端音色选择器

- **Status**: verified
- **Scope**: `src/shells/speech/**`, `src/plugins/speech-service/**`, `src/workbench/**`, `src/shells/obsidian/**`, `src/shells/web/**`, `tests/**`
- **Verified-Commit**: f470ec896c13b916c3c3ce16ee374f5365d1ac23
- **Updated**: 2026-11-09
- **验收摘要**：Worker 类型检查、全仓测试（237 通过、56 跳过）与构建通过；独立 Tester 在 Web 与真实隔离 Obsidian 读取 103 个音色及三分组，验证本机/云端音色分别持久化、重开恢复及真实阅读页听读。`zf_001` / `zm_010` 两端均收到真实 Kokoro HTTP 200，Web 音频 49,768 / 52,298 字节，原生 49,876 / 52,294 字节；明暗窄幅及未安装/损坏状态已看图审视，未独立评价音色声学质量。截图：`.tmp/evidence/task-30/final-web-zm.png`、`.tmp/evidence/task-30/final-native-zm.png`、`.tmp/evidence/task-30/final-native-listen-zf.png`、`.tmp/evidence/task-30/final-web-dark-narrow.png`、`.tmp/evidence/task-30/final-native-error.png`。
- **授权范围**：允许修改 `src/shells/speech/speechGateway.ts`、`src/shells/speech/speechRuntime.ts`、`src/plugins/speech-service/neuralSpeech.ts`、`src/workbench/**`、`src/shells/obsidian/index.ts`、`src/shells/web/client.ts`、`src/shells/web/server.ts` 及 `tests/**`。
- **不在范围内**：严禁修改 `src/core/` 冻结契约；严禁硬编码死板的固定 sid=48 而不允许切换。
- **背景与实证根因**：
  - **当前使用的 Kokoro 版本**：`kokoro-int8-multi-lang-v1_1`（对应 HuggingFace `hexgrad/Kokoro-82M-v1.1-zh` 的 `k2-fsa/sherpa-onnx` int8 多语种版本，内置 `espeak-ng` + 美英/英英/中文词典 + 中文日期/数字/电话 FST，共含 **103 个内置音色** `sid: 0 ~ 102`）；
  - **为什么之前无法选择音色**：
    1. `src/shells/speech/speechGateway.ts:15` 硬编码了 `const audio = tts.generate({ text, speed, sid: 48 });`，完全忽略了 `POST /v1/audio/speech` 请求体传入的 `input.voice` 参数！
    2. 设置面板在 `本机语音服务` 模式下没有暴露音色选择下拉框，而在 `云端语音服务` 模式下也只是一个裸 `<input>` 文本框。
  - **如何动态获取模型内置音色（零硬编码文件解析）**：
    - `kokoro-int8-multi-lang-v1_1/model.int8.onnx` 文件尾部的 ONNX Protobuf 元数据中直接内嵌了完整的 `speaker2id` 与 `speaker_names` 字典（共 103 个音色：含英文女声 `af_maple->0, af_sol->1, bf_vale->2`、中文女声 `zf_001->3 ... zf_099->57`、中文男声 `zm_009->58 ... zm_100->102`，默认 `sid: 48` 对应 `zf_084`）！
- **接口与行为契约**：
  1. **从 `model.int8.onnx` 动态解析内置 `speaker_names / speaker2id` 并在网关与运行时暴露（`speechGateway.ts` & `speechRuntime.ts`）**：
     - 从已安装的 `kokoro-int8-multi-lang-v1_1/model.int8.onnx` 二进制（读取文件尾部或扫描 `speaker2id` / `speaker_names` 元数据段）动态提取全部音色列表（如 `{ id: "zf_001", sid: 3, group: "中文女声 (zf)" }`、`{ id: "zm_009", sid: 58, group: "中文男声 (zm)" }`、`{ id: "af_maple", sid: 0, group: "英文女声 (af/bf)" }`）；
     - 在 `SPEECH_GATEWAY`（`speechGateway.ts`）中：
       - 新增 `GET /v1/audio/voices`（并在 `GET /health` 中一并返回 `voices`），返回动态解析出的内置音色数组及默认音色（如 `zf_001` 或 `zf_084`）；
       - 在 `POST /v1/audio/speech` 中读取请求体的 `input.voice`：支持传入音色名（如 `"zf_001"`、`"zm_010"`、`"af_maple"`）或数字 ID（`"0" ~ "102"`），将其映射为对应的 `sid` 传给 `tts.generate({ text, speed, sid })`（若传入未识别的云端默认词如 `"alloy"` 或空值，回退至默认中文/多语种音色 `sid: 48` 而不报错）。
  2. **本机与云端模式下提供友好的「朗读音色（Voice）」选择控件（`obsidian/index.ts` & `web/client.ts` & `web/server.ts`）**：
     - **本机语音模式（`local`）**：当本机语音引擎已安装时，自动从本机模型动态读取内置音色列表，在设置面板渲染带分组（`<optgroup label="中文女声 (zf)">`、`<optgroup label="中文男声 (zm)">`、`<optgroup label="英文音色 (af/bf)">`）的 **`朗读音色`** `<select>` 下拉框，选择后立即保存至 `speechConfig.ttsVoice` 并在点击 `🎧 听读` 时生效；
     - **云端语音模式（`cloud`）**：保留自定义音色能力（支持常用预设选项或输入音色名）。
- **Worker 工程内环门禁（交卷前置条件）**：`npm run typecheck && npm test && npm run build:obsidian` 全绿（自动同步至 `.dev-vault` 与 `ganfan-media`）；新增单测与浏览器回归测试覆盖：1) 动态解析 `model.int8.onnx` 元数据提取出 `af_maple`、`zf_001`、`zm_100` 等 103 个音色映射；2) 切换不同音色（如 `zf_001` vs `zm_010`）调用 `/v1/audio/speech` 时网关使用对应 `sid` 合成出不同音频；3) 设置面板在本机模式下展示分组音色下拉框并持久化；完成手动破壁验证并截屏存入 `.tmp/evidence/task-30/` 自检。
- **Tester 模拟用户终验要求**：在 Web 与真实隔离 Obsidian 中验证本机语音设置下的动态分组音色下拉框（含中文女声、中文男声、英文音色）、切换音色后持久化及实际听读请求携带所选 `voice`，终验截图归档至 `.tmp/evidence/task-30/`。


---

## [Task #31] 语音下载协议容错加固与 Agent 环境探针轻量化

- **Status**: verified
- **Scope**: `src/shells/speech/speechDownload.ts`, `src/plugins/guide-acp/discovery.ts`, `src/shells/web/nodeProcess.ts`, `tests/**`
- **Verified-Commit**: d5ee65f63477bbf71693c810e33bd1086e9f7e59
- **Updated**: 2026-11-09
- **验收摘要**：Worker 类型检查、全仓测试（244 通过、56 跳过）、构建及手动破壁通过；独立 Tester 使用小型有效归档，经 Web 安装 UI 和真实 curl 验证 Range 请求收到 200 完整体后 SHA 匹配并安装完成；504 两次后恢复、四次耗尽，取消/坏哈希/超限均保留原分片。沙盒 HOME 与配置环境依赖 CLI 经真实发现入口识别并完成标准 ACP 初始化，非 ACP 输出被拒绝，超时约 4 秒返回失败。证据：`.tmp/evidence/task-31/final-observations.json`、`.tmp/evidence/task-31/final-web-install-200.png`、`.tmp/evidence/task-31/final-web-agent-discovery.png`、`.tmp/evidence/task-31/final-web-agent-timeout.png`。
- **接口与行为契约**：续传请求收到 HTTP 200 完整体时，SHA 校验通过后可成功；不得将完整体追加到旧分片或接受未通过校验的数据。HTTP 504 自动有限重试，保留取消、大小限制和分片保护。Agent 版本/能力探针继承合法 HOME 与 Agent 配置环境，不再强制空配置目录；保留超时和标准 ACP 能力验证，不读取私有配置、不改 model/effort。
- **Worker 工程内环门禁**：类型检查、全仓测试、Obsidian 构建通过；覆盖 200 完整体/错误哈希/大小限制、504 重试/耗尽/取消与配置环境继承，完成手动破壁并在业务提交记录证据。
- **Tester 独立验收**：通过真实下载入口验证受控 HTTP 200 与 504；通过用户可见 Agent 探测入口验证配置可读的 CLI 被识别及超时失败保持明确。UI 证据归档 `.tmp/evidence/task-31/`，仅使用专用沙盒。
