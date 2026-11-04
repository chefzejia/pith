# Pith · 跨会话交接单（HANDOFF Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈协同契约（详见 [ROLES.md](ROLES.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/003-interaction.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（区块内标记 `- **Status**: pending`）写入本文件，并执行隔离提交 `git commit --only docs/HANDOFF.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒，在同一轮次内循环 `wait_agent` 按序调度常驻 Worker 与独立 Tester 完成实现与 `.dev-vault` 真机验收：每完成一单先重读确认未被标为 `superseded`，再仅将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附 `Verified-Commit`）并 `git commit`；**提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #11] Wave 11：图标体系回归、一级/二级工具空间分层、顶部近源弹出修复、以及傻瓜化唯一标准设置面板

- **Status**: verified
- **Verified-Commit**: 56dfaba
- **Updated**: 2026-11-04
- **验收结论**：类型检查、196 项测试、Obsidian 构建和真实客户端验收脚本通过。独立 Tester 在 `.dev-vault` 实测宽窄阅读栏弹层、EPUB 章节、默认及显式工具、Agent 自动选择和设置重载；云端请求使用测试替身，未验证真实语音服务。
- **上游 Brain 裁决（解除 `blocked`）**：
  1. **390px 阅读栏弹层与顶栏重叠 12px 已定位并修复**：当 `data-hit-target="44"` 生效时，顶栏高度由 44px 变为 56px，写死 `top: 44px` 会导致重叠 12px。现已将 `.pith-typography-popover` 与 `.pith-dojo-panel` 挂载于 `.pith-bottom-dock`（顶栏容器）内并改用 `top: 100%`（无论顶栏是 44px 还是 56px 均 100% 紧贴顶栏下沿零重叠）。
  2. **密钥安全存储失败时的会话内存兜底裁定通过**：当宿主机 Keychain / `secretStorage` 不可用（如在 `--use-mock-keychain` 或无加密存储环境下）时，**仅使用当前会话内存（in-memory `session` Map）兜底是完全正确且符合安全红线的做法**——严禁将 API Key 明文持久化写入 Vault 磁盘文件（`data.json` 或 `web-settings.json`）！现有 `createObsidianSecretAccess` 的会话内存兜底设计完全满足要求，直接放行验收。
- **上游 Brain 与用户拍板裁决（针对上一轮 `blocked` 事项 + macOS 钥匙串弹窗根治）**：
  0. **根治 macOS `找不到用于储存“obsidian”的钥匙串` 系统弹窗（最高优先级）**：
     - 每次通过命令行 `spawn("/Applications/Obsidian.app/Contents/MacOS/Obsidian", ...)` 启动隔离实例（如在 `scripts/verify-obsidian-e2e.ts` 中）时，**必须传入 Chromium/Electron 参数 `--use-mock-keychain` 和 `--password-store=basic`**！否则在非 GUI Session / Codex 沙箱下启动 Chromium `safeStorage` 会频繁触发 macOS SecurityAgent 弹出系统级“找不到钥匙串”模态框打断用户！
     - 同时，在 `src/shells/obsidian/index.ts` 中，当调用 `app.secretStorage` 之前或失败时提供本地插件数据兜底（避免在无需云端语音的默认本机模式下无故触发 `secretStorage` 访问）。
  1. **实训工具两阶段筛选与 `toolkits` 语义冻结**：
     - 当 `topic.toolkits` 为空数组 `[]` 时，UI 渲染层（`toolkitSlot` / 视图层，无需修改已有 `topic.md` 磁盘存储，也无需改变旧 API 对 `topic.toolkits` 存储数组的返回）在顶栏计算有效工具列表时，若 `topic.toolkits.length === 0`，在阅读视图顶栏按当前打开的内容格式提供默认一级工具（书本/文章 `epub | pdf | cbz | markdown` 默认为 `["feynman"]`；音视频/字幕 `media | .vtt | .srt` 默认为 `["shadowing"]`）；
     - 若向导 Agent 显式配置了非空的 `topic.toolkits`（如 `["shadowing"]` 或 `["feynman", "shadowing"]`），则按该数组展示；
     - 若向导或用户显式传入 `["none"]`，则代表显式清空所有实训工具（此时顶栏仅显示带工具扳手图标的轻量入口，不默认挂载 `feynman`/`shadowing`）。
     - *注：在 `/api/dojo/transform` 和 `/api/dojo/diagnose` 校验中，当 `topic.toolkits.length === 0` 时，同样允许该课题关联材料格式对应的默认工具（书本/文章允许 `feynman`，音视频允许 `shadowing`）通过校验！*
  2. **云端自定义语音端点安全契约冻结（`src/plugins/speech-service/neuralSpeech.ts`）**：
     - 放开 `api.openai.com` 硬编码域名白名单：在云端模式（`kind === "cloud"`）下，允许用户配置任意合法的 `https://` 兼容网关 URL（校验满足 `https:` 协议、无 URL 账号密码 `@`、无 `?query` / `#hash`、主机名非内网/回环地址，且 `HostPort.http` 请求默认不跨源转发 Bearer Token）；`asrProvider === "openai-whisper"` 同样读取用户配置的自定义 `asrLoopbackUrl`（若为 `https://` 合法云端端点则使用该自定义端点，留空则使用默认 `https://api.openai.com/v1/audio/transcriptions`）。

### 背景与用户真机诊断（必须 100% 解决的 4 大心智违和问题）
用户在查看 `.dev-vault` 真机截图后指出以下 4 个严重违反用户心智的设计缺陷：

1. **图标语义错误**：
   - Pith 的主图标（Obsidian Ribbon 图标与 `PithWorkspaceView.getIcon()`）应该改回原先 Garden 的植物图标 **`sprout`**（而非 `book-open`）；
   - 顶栏的实训工具入口不应该是一个莫名其妙的 `+` 号，而应该是代表**训练/工具**的图标（如扳手/工具图标 + 工具名）；
   - 顶栏开启向导助手的图标应该是一个**问号图标（`?` / `help-circle`）**（`PithGuideView.getIcon()` 也同步改为 `"help-circle"`），代表“有疑问找向导”。

2. **顶栏一级工具（两阶段筛选）vs 内容正下方二级区域的严格边界**：
   - **一级工具（全部在顶栏右侧，与「听读」同层级）**：
     - **第一阶段（无需 AI · 按内容格式默认筛选第一批工具）**：当打开书本/文章（`epub` / `pdf` / `cbz` / `markdown`）且 `topic.toolkits` 尚未由 AI 显式设置为空以外的值时，默认筛选展示适合阅读内化的 **`feynman`（费曼复述）**；当打开音视频/字幕（`media` / `.vtt` / `.srt`）时，默认筛选展示 **`shadowing`（影子跟读）**。
     - **第二阶段（AI 介入后二次筛选）**：当向导 Agent 介入修改了 `topic.toolkits` 后，按 `topic.toolkits` 展示注入/卸载后的工具。因此「费曼复述」、「影子跟读」与「听读」是平级的一级工具！
   - **内容正下方区域（Bottom Area）的唯一准入规则**：
     - **内容正下方区域唯独只有音频播放控制条（`.pith-media-deck`）才能进入！** 其他任何浮层或面板严禁出现在内容正下方。

3. **排版设置 `[Aa]` 竟然出现在屏幕最下方/左下角（严重空间割裂）+ 封面粘连“版权信息”**：
   - **根因 1（`[Aa]` 跑到底部）**：`plugin.ts:45` 的 `bottom-sheet` CSS 规则（当容器宽度 `< 740px` 或比例 `< 0.85` 时触发）把 `.pith-typography-popover` 和 `.pith-dojo-panel` 强行设成了 `bottom: 0; left: 0; right: 0` 从屏幕底部弹出！用户点击右上角的 `[Aa]` 或实训工具，眼睛看着右上角，菜单却在屏幕最底下出现，极其割裂！
   - **修复 1**：**彻底移除将 `.pith-typography-popover` 和 `.pith-dojo-panel` 放到屏幕底部的样式！** 点击右上角 `[Aa]` 或顶栏工具时，弹出卡片**永远紧贴顶栏右上方（`top: 44px; right: 8px`）近源向下展开**！
   - **根因 2（封面页下方粘着“版权信息”标题）**：截图 1 中封面大图下方露出了第二章“版权信息”四个字。必须在分页模式下为每个 `.pith-epub-chapter + .pith-epub-chapter` 强制设置 `break-before: column;`（每章独立起新列/新页），确保封面页干干净净只有封面！

4. **插件设置页（`PithSettingTab`）过度暴露底层概念、违反“唯一标准”且交互反人类**：
   - 用户痛点：*“我是看不懂这个设置的，为什么 Pith 不能帮我做好？我只需要使用就好了。自定义端点应该作为可选项披露。为什么要区分 OpenAI 和 Azure，我们前面不是说只用唯一标准吗？扫描并配置本机 Agent 按钮放在最下面也很反人类。”*
   - 而且上次 E2E 脚本还在 `.dev-vault/Pith/_cache/web-settings.json` 里残留了 `e2e-tts-model` / `e2e-voice` 等脏数据！
   - **彻底重做设置页（`src/shells/obsidian/index.ts` & `src/shells/web/server.ts`）**：
     1. **向导 Agent 自动扫描与即选即存（对标 `ganfan-garden/src/settings.ts`）**：
        - 打开设置页时**自动触发后台扫描本机 Agent（`dsh / claude / codex`）**；若当前未配置且扫描到本机有可用 Agent（优先 `dsh`），**自动帮用户选中并保存**！
        - 在「本机 Agent」下拉框同行右侧放一个轻量的 `[重新检测]` 按钮，下拉框或术语风格改变时**立即自动保存（Auto-save on change）**，彻底砍掉最底下反人类的 `[扫描并配置本机 Agent]` 和 `[保存设置]` 按钮！
     2. **语音服务：统一为「唯一 OpenAI 兼容标准协议」+ 高级端点默认折叠（`<details>`）**：
        - **UI 层彻底移除 Azure 区分（移除 `Azure Neural`、`Azure 区域`、`Azure Speech Key` 及杂乱的 `8765/8766` 端口枚举）**！
        - 语音设置默认只展示极简直观的两项：
          - **语音服务模式**：下拉框仅分 `本机语音服务（免配置自动连接）` 与 `云端语音服务（OpenAI 标准协议）`（切换即自动保存）；选择云端时才显示 `API Key` 密码框与 `[检测连接]` 按钮；
          - **`▸ 高级自定义端点与模型（可选）`**：使用原生 `<details><summary>高级自定义端点与模型（可选）</summary>...</details>` 默认折叠收起！只有用户主动展开时，才显示自定义的 `TTS 端点 URL`、`TTS 模型`、`音色`、`ASR 端点 URL`、`ASR 模型`。
        - 清理 `.dev-vault/Pith/_cache/web-settings.json` 中残留的 `e2e-*` 测试脏数据，且确保 `verify-obsidian-e2e.ts` 跑完后自动恢复默认干净配置！

### 授权修改范围（Worker · 含 Router 同目标裁决权）
- `src/plugins/speech-service/neuralSpeech.ts` & `src/plugins/speech-service/index.ts`
- `src/plugins/guide-acp/`（如需支持 `"none"` 工具标识）
- `src/shells/obsidian/plugin.ts` & `src/shells/obsidian/index.ts`
- `src/shells/web/server.ts`
- `src/shells/toolkitSlot.ts`
- `src/plugins/stage-reader/`
- `scripts/verify-obsidian-e2e.ts`
- `tests/` 下相关测试文件

### 验收标准（Tester）
- `npm run typecheck && npm test && npm run build:obsidian && npm run verify:obsidian` 全部零报错通过；
- `.dev-vault` 真实桌面 Obsidian 客户端核验：
  1. Ribbon 与主视图图标为 `sprout`，实训工具带工具图标，向导按钮为问号 `?`（`help-circle`）；
  2. 书本/文章默认在顶栏右侧展示一级工具 `[🛠 费曼复述]`（媒体展示 `[🗣 影子跟读]`），与 `[🎧]`、`[Aa]`、`[?]` 同级；内容正下方除播放条 `.pith-media-deck` 外无任何其他面板；
  3. 无论窗口宽窄，点击 `[Aa]` 或实训工具均在顶栏右上方（`top: 100%; right: 8px` 紧贴顶栏下沿，零重叠）近源弹出，绝不跑到底部；EPUB 章节间强制分页（`.pith-epub-chapter + .pith-epub-chapter { break-before: column }`），封面页底部不再出现“版权信息”标题；
  4. 打开设置页自动扫描并配置可用本机 Agent、修改即自动保存；语音设置不再暴露 Azure 分支，自定义端点/模型收纳在默认折叠的 `<details>` 中，且 `.dev-vault` 无 `e2e-*` 残留脏数据；
- 验收通过后，由 Router 仅将本 `[Task #11]` 区块更新为 `- **Status**: verified`（附 `Verified-Commit`）并 `git commit` 收口。

---

## [Task #12] 修复 EPUB 书内链接与实训工具默认挂载

- **Status**: verified
- **Verified-Commit**: e07677c
- **Updated**: 2026-11-04
- **验收结论**：类型检查、200 项测试及隔离 Obsidian 构建通过；独立 Tester 在 Web 与 `.dev-vault` 真实 Obsidian 实测书内导航、伪造标记与工具选择。Guide 注入和卸载通过受控替身验证，未验证真实模型理解意图。
- **上游 Brain 根因修复（解除 `blocked`）**：
  - 针对第三轮“原书正文伪造 `.pith-epub-chapter` 类干扰章节索引”：已在 `src/plugins/stage-reader/epub.ts` 序列化属性与 `<body>` 类名时剥离所有以 `pith-` 开头的宿主保留类名前缀，并为真章节 `<section>` 写入 `data-epub-chapter="${chapter}"`；同时在 `src/plugins/stage-reader/pagination.ts` 的 `resolveEpubTarget` 中优先按 `article.children` 直接子章节元素定位。请直接复验并完成收口。
  - 同时请阅读新增的 [LESSONS.md](LESSONS.md) 与更新后的 [ROLES.md](ROLES.md)。

### 目标

用户反馈书页内的原书目录无法点击；实训工具默认不显示，应由 Guide 理解课题目标和用户意图后选择性注入。此任务以新决策取代 Task #11 中按材料格式默认显示费曼或跟读的规则。费曼复述具体练习流程、反馈机制和评分尚未确定，不在本任务设计或实现范围内。

### 行为契约

1. **EPUB 书内导航**：保留并解析原书内容中的内部链接，包括同一 XHTML 的 fragment、跨 XHTML 文件及带 fragment 的跨文件链接。相对路径相对于链接所在 EPUB 文件解析，准确区分不同章节中重名的 fragment；只允许解析到本书有效阅读单元，缺失或不安全目标不执行跳转并给予明确反馈。复用已有 locator/目录导航能力，书内点击必须到达正确章节及目标位置；分页时显示目标所在屏，滚动文章保持适当定位。目录、正文及注释引用使用同一安全内部导航逻辑，外链和危险协议不冒充书内链接，也不削弱已有安全隔离。
2. **工具默认与注入**：`topic.toolkits: []` 始终表示无已挂载实训工具，不按材料格式自动填充或授权任何实训工具；格式可用于判断适用性，但不能单独触发挂载。Guide 根据课题目标及用户实际意图，沿现有 `pith_configure_toolkits` / directive 能力注入或卸载；离线或无明确意图时不自动挂载。已保存的非空工具列表继续生效；旧数据的 `none` 按无工具处理，不在读取时批量改写用户数据。`[]` 可通过现有配置工具显式清空。
3. **直接入口**：无挂载工具时不显示实训入口；已注入时从顶栏直接进入对应工具。多个已注入工具的选择在入口处完成；不在已打开的练习面板内提供能切换到其他工具的“工坊”选择器。保留现有已注入工具的可用功能，不重设计费曼或跟读流程，不引入插件开关设置。

### 授权范围

`src/plugins/stage-reader/`、`src/plugins/guide-acp/`、`src/shells/obsidian/`、`src/shells/web/`、`src/shells/toolkitSlot.ts` 和相关 `tests/`；测试脚本仅在真实验收需要时修改。`src/core/` 公共契约与持久化格式不得擅自修改，若确需修改，写明证据并标记 blocked 交 Brain 裁定。

### 验收

- 使用最小多章节 EPUB fixture 验证同文件与跨文件链接、fragment、重复 fragment ID、目标缺失、路径逃逸和危险/外部链接；不改变或扩大原书/网络访问权限。由独立 Tester 在 Web 与固定 `.dev-vault` 的真实 Obsidian 阅读器中，经实际点击验证分页导航目标；可只读复用测试库现有示例书，不操作真实 Vault。
- 测试各内容格式在空列表/无 Agent 时均无实训入口、无默认授权；已保存工具、Agent 注入、卸载与空列表清除在刷新/重开后行为一致，旧 `none` 兼容且不改写数据。验证多工具从入口可选择，面板内没有第二个工具选择器；费曼原有练习逻辑不被重新设计。
- 运行 `npm run typecheck`、相关回归与完整 `npm test`，构建 Obsidian；列出真实客户端验证的范围和未覆盖项。严格保护用户正在使用的桌面会话，不为测试擅自关闭真实 Obsidian、修改钥匙串或访问真实 Vault；若无法安全完成真实客户端验收则如实 blocked，不以替身冒充真机。
- 结果与证据写回本任务区块；只有独立 Tester 通过后才标记 verified。

---

## [Task #13] 架构清创：铲除函数重赋值套娃、抠源码字符串假测试、沙盒快照反模式，并统一 1/2/3 栏用户偏好分页与 PluginRuntime 热重配

- **Status**: blocked
- **Verified-Commit**: none
- **Updated**: 2026-11-04
- **阻塞原因**：连续三轮真实界面验收发现缺陷。前两轮的设置布局和 Obsidian 翻页卡住已修复；第三轮 Web 单栏、大字号下将窗口从 1600×900 缩至 1100×700 时，跨页无空格中文段落的可见位置从标记 025–048 回退至 013–024，原标记 033 不再可见。复现材料为 `.tmp/task13-visual/long-chinese.epub`，对照截图为 `.tmp/task13-visual/screenshots/round3-long-page2-large.png` 与 `round3-long-resized.png`。实现修改保留在工作区，尚未提交；真实 Obsidian 的该长段落场景及原生边框拖拽缩放尚未验收。
- **执行环职责切分与专用沙盒直接读写指令（必读，详见 [ROLES.md](ROLES.md) & [AGENTS.md](../AGENTS.md)）**：
  1. **工程代码自检归 Worker**：编译、类型检查、单元测试、架构守卫单测与对应产物构建由 Worker 在交卷前跑通；
  2. **按交付形态模拟真实用户归 Tester**：Tester 不写单测脚本、不拿脚本 `ok: true` 充数，而是根据本任务涉及的目标宿主形态（如 Web 壳、Obsidian 壳或 DSH 工具包壳）完全模拟真实用户操作与审视产物；
  3. **专用测试沙盒直接读写、零防御内耗**：仓库内已列入 `.gitignore` 的专用测试沙盒（如 `.tmp`、`.dev-vault`）本来就是供 Agent 随意覆盖、改写和操作演练的游乐场！严禁 Router 或 Tester 以“不能覆盖沙盒内现有文件”为由阻塞验收，严禁要求 Worker 研究或编写快照备份、回滚或进程树扫描代码！

### 背景与目标（基于全仓「打补丁 vs 根因解决」专项审计，详见 [LESSONS.md](LESSONS.md)）
全仓审计发现多处典型的“表层补丁 / 凑测试 / 契约失真”反模式，必须在继续新增业务功能前一次性完成根因级清创。**本任务包中子模块 1（Core/PluginRT & Stage-Reader 分页）与子模块 2（Scripts & Tests 清创）可按 [ROLES.md](ROLES.md) 规则组织执行，Tester 首轮审查必须一次性穷尽全部静态与真机验证项。**

### 核心根因清创要求

1. **铲除 `src/shells/web/server.ts` 的 5 层函数重赋值套娃与死代码截胡**：
   - 将 `server.ts` 中被 5 层包装的 `renderTraining`（`renderTrainingBase` / `renderTrainingWithControls` / `renderTrainingWithChooser` / `trainingChromeBase` / `renderTrainingWithMediaControls`）以及多层包装的 `home`、`workspace`、`openTopic`、`startSpeech` 合并为**单一、清晰的函数定义**，直接将 DOM 渲染到正确的目标容器中（严禁先渲染在 `#training` 再用 `document.body.append` / `readerTools.append` 拔节点搬家）；
   - 删除 `server.ts` 中被 `stopImmediatePropagation()` 屏蔽的旧设置表单死代码（`L409-414`），保留唯一生效的简化设置入口；
   - 在 `tests/boundaries.test.ts` 中新增静态守卫：扫描 `src/**` 严禁出现 `const \w+Base\s*=` 同名函数重赋值套娃模式。

2. **废除 `readFile("src/...") + vm.runInContext` 抠源码字符串假测试**：
   - 清理或重写 `tests/wave8-asr-tester-regressions.test.ts`、`tests/core-epub-and-typography.test.ts`、`tests/obsidian-e2e-safety.test.ts` 等文件中通过 `readFile` 切取 `src/` 源码行塞入 `vm.runInContext` / `vm.runInNewContext` 的测试，改为直接 `import` 真实导出的模块函数或通过真实 HTTP / 渲染器验证；
   - 在 `tests/boundaries.test.ts` 中新增静态守卫：扫描 `tests/**` 严禁同时使用 `readFile` 读取 `src/` 源码并送入 `runInContext` / `runInNewContext`。

3. **清理 `scripts/` 下的沙盒快照回滚与全局 `assertNoObsidian` 封锁**：
   - 移除 `scripts/obsidian-safety.mjs`、`scripts/verify-obsidian.mjs`、`tests/obsidian-e2e-safety.test.ts` 中对 `.dev-vault` 的快照回滚恢复逻辑，以及 `scripts/verify-obsidian-e2e.ts` 中的 `assertNoObsidian()` 全局进程拦截（保留 `--user-data-dir`、动态 CDP 端口、`--use-mock-keychain --password-store=basic` 与仅关闭自身派生 `child` 进程的干净实现）；
   - `scripts/build-obsidian.mjs` 直接构建并覆盖同步 `.dev-vault/.obsidian/plugins/pith/`，不再向 `.tmp/` 写入 `pith-build-backup-*` 备份目录；
   - `package.json` 的 `verify:obsidian` 直接执行 `npm run build:obsidian && node --experimental-strip-types scripts/verify-obsidian-e2e.ts`。

4. **重构阅读器栏数模型（支持用户明确选择 `1 / 2 / 3` 栏 + 真实 `.pith-reader` 宽度自适应）**：
   - 更新 `src/core/seams.ts`、`src/plugins/stage-reader/pagination.ts`、`src/shells/obsidian/plugin.ts` 与 `src/shells/web/server.ts`：
     - 将用户栏数偏好扩展为 `"single" | "double" | "triple"`（UI `[Aa]` 面板提供 **`单栏` | `双栏` | `三栏`** 三个按钮，默认 `单栏`）；
     - **彻底移除以窗口宽高比（`aspectRatio >= 1.15`）或窗口高度（`height >= 520`）禁用多栏的死板规则**！仅根据**实际阅读容器（`.pith-reader` / `.reader`）的实时宽度 `W`** 与最小可读列宽（每栏至少 `320px` 净宽 + 栏间距）判定最大可容纳栏数 `maxColumns`（1、2 或 3），不满足宽度的栏数按钮置灰禁用，满足时严格尊重用户所选的 `1 / 2 / 3` 栏（哪怕在超宽屏上用户选了 `单栏`，也必须保持 1 栏！）；
     - 补齐消费 `--pith-page-scroll-extent` 的 CSS 规则（确保最后一屏对齐），将 `ResizeObserver` 绑定在実際の `.pith-reader` / `.reader` 上，且切换字号、开关侧栏、展开/收起音频条时统一触发重排并保持当前阅读位置（`IntrinsicLocator`）。

5. **内核 `PluginRuntime` 原生支持插件配置变更重挂 & 区分 Agent `"offline"` 与 `"unconfigured"`**：
   - 在 `src/core/pluginrt/runtime.ts` 中记录每个激活插件已应用的 `config` 快照；当 `reconcile()` 发现已激活插件的 `config` 发生变化时，自动停用并重新挂载该插件及其下游依赖，从而移除 `shells/obsidian/index.ts` 与 `shells/web/server.ts` 外层的手动关停重启补丁；
   - 区分 Agent 配置的“尚未初始化”与“用户主动选择离线模式”，确保用户选定“离线模式”后再次打开设置页不会被自动扫描篡改回 `dsh`。

### 授权修改范围
- `src/core/seams.ts` & `src/core/pluginrt/runtime.ts`
- `src/plugins/stage-reader/` & `src/plugins/speech-service/` & `src/plugins/guide-acp/`
- `src/shells/**`
- `scripts/**` & `package.json` & `.gitignore`
- `docs/003-interaction.md`
- `tests/**`

### Worker 工程自检门禁 vs. Tester 模拟真实用户验收标准（首轮穷尽）
- **Worker 工程自检门禁（交卷前置条件）**：
  - `npm run typecheck && npm test && npm run build:obsidian` 全部零报错通过（包括 `tests/boundaries.test.ts` 新增的「零函数重赋值套娃」与「零抠源码 `runInContext`」守卫单测全绿），确保最新构建产物已同步至 `.dev-vault`；
- **Tester 模拟真实用户验收（直接操作 `.dev-vault` 玩具沙盒与 Web 界面，严禁只跑脚本看 `ok: true`）**：
  - 像真实人类用户一样在 `.dev-vault` 的 Obsidian 窗口与 Web 壳中实际点击、切换 `单栏 / 双栏 / 三栏`、在超宽屏下选择 `单栏`、调整字号与拖拽缩放窗口、打开设置面板切换离线模式并重开，**每一步截屏用视觉（`view_image`）肉眼审视画面排版、分栏对齐、位置保持与文案体验**。

