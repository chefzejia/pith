# Pith · 跨会话交接单（HANDOFF Queue）

> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **单文件滑动任务栈协同契约（详见 [ROLES.md](ROLES.md)）**：
> - **思考环（Brain）**：冻结 `src/core/` 与 `docs/003-interaction.md` 契约后，以独立编号区块 `## [Task #N] <标题>`（区块内标记 `- **Status**: pending`）写入本文件，并执行隔离提交 `git commit --only docs/HANDOFF.md`（若上一轮 `#N-1` 仍在执行，直接在末尾追加 `## [Task #N]` 绝不覆盖 `#N-1`；若推翻未完旧单，将其改为 `- **Status**: superseded (by #N)` 并追加新单；文件内仅保留未结案区块 + 最近 1~2 个已结案锚点）；
> - **执行环（无人值守 Router → Worker & Tester）**：由 `.git/hooks/post-commit` 的 `[AUTO-WAKEUP]` 信号唤醒，在同一轮次内循环 `wait_agent` 按序调度常驻 Worker 与独立 Tester 完成实现与 `.dev-vault` 真机验收：每完成一单先重读确认未被标为 `superseded`，再仅将该 `[Task #N]` 区块更新为 `- **Status**: verified`（附 `Verified-Commit`）并 `git commit`；**提交后结束回合前必须再次检查本文件是否仍有新增的 `- **Status**: pending` 区块（Drain-Loop），若有则立即继续执行直至队列彻底排空**。

---

## [Task #10] Wave 10：补齐 Garden 四项核心体验细节——分页图片防截断、向导专属图标、语音一键直达配置与 SecretStorage、多级树状可折叠目录

- **Status**: verified
- **Verified-Commit**: 9505d96
- **Updated**: 2026-11-03
- **验收结论**：类型检查、179 项测试、Obsidian 构建和真实客户端验收脚本通过。独立 Tester 在 `.dev-vault` 真机核验图片与 SVG 封面、分页图注、向导图标、语音设置与 SecretStorage，以及真实多级 EPUB 目录；桌面操作由 CDP 驱动，语音健康检查使用受控服务，未验证真实语音播放。

### 背景与根因定位（对标母本 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden`）
用户在 `.dev-vault` 真机体验后指出 4 个丢失的细节，经源码比对定位根因如下：
1. **分页模式下图片无法自适应、在当页底部被截断**：
   - 根因：`ganfan-garden/styles.css:1264-1269` 与 `pagination.ts:63-67` 明确对分栏容器内的 `img, svg, math, figure` 设置了 `break-inside: avoid; max-width: 100%; max-height: var(--pith-page-media-height, var(--pith-page-height)) !important; object-fit: contain;`，并在每次 `applyPaginationStyles` 时扣除上下 margin 计算 `--pith-page-media-height`。而当前 `src/shells/obsidian/plugin.ts` 与 `src/plugins/stage-reader/pagination.ts` 漏掉了这套规则，导致高图/插图在多列分页中溢出或被跨列截断！
2. **开启向导助手的图标与 Obsidian 侧边栏缩放图标撞车**：
   - 根因：`plugin.ts:191` 中 `.pith-guide-toggle` 画的是 `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>`（即布局侧栏框图标 `◨`），与右上角紧挨着的 Obsidian 原生右侧边栏折叠图标长得一模一样！应替换为清晰的**对话气泡/向导专属图标**（如双对话气泡 `messages-square` / 带星芒的对话图标，与 `PithGuideView.getIcon()` 一致），视觉上一眼区分“召唤 AI 向导”与“Obsidian 窗口侧边栏缩放”。
3. **点击朗读没有声音，且界面找不到语音配置入口 / 云端 Key 无法在界面配置**：
   - 根因有两处：① 用户在阅读器内点击 `🎧` 未连接语音时，仅弹出一句纯文字 `.pith-toast-tip` 2 秒就消失，界面上没有任何入口跳转到语音设置（在 Obsidian 中应提供可点击的 `[打开语音设置]` 动作直接调用 `app.setting.open()` + `app.setting.openTabById("pith")`，且提示停留更充裕如 4.5s）；② 在 `src/shells/obsidian/index.ts` 的 `PithSettingTab` 中，只读取了 `process.env[key]`，没有像 `ganfan-garden/src/settings.ts:301-307` 那样接入 Obsidian `app.secretStorage`（及插件本地安全兜底）让用户在设置面板直接填写 `OPENAI_API_KEY` / `AZURE_SPEECH_KEY` 并提供 `[检测语音连接]` 按钮！
4. **目录（TOC）是平铺的，丢失了多级章节折叠（`▸ / ▾`）与当前章自动展开**：
   - 根因：`ganfan-garden/src/views/MaterialMap.ts:61-107` 实现了完整的树状可折叠目录（带 `▸ / ▾` 展开/收起按钮、`aria-expanded`、子级 `<ul>` 显隐、以及打开目录时自动定位并展开当前所在章节的祖先节点 `aria-current="location"`）。而当前 `plugin.ts:224` 与 `web/server.ts:379` 只是用 `sections.map(...)` 平铺了一堆 `button` 加 `paddingLeft`！

### 授权修改范围（Worker · 含 Router 同目标裁决权）
- `src/plugins/stage-reader/pagination.ts` & `src/plugins/stage-reader/epub.ts` & `src/plugins/stage-reader/index.ts`
- `src/shells/obsidian/plugin.ts` & `src/shells/obsidian/index.ts`
- `src/shells/web/server.ts`
- `scripts/verify-obsidian-e2e.ts`
- `tests/` 下相关测试文件
- *注：`src/core/seams.ts` 中 `ReaderSectionHeading.children` 已由 Brain 提前冻结完毕。*

### 具体实现要求

1. **分页图片/媒体自适应防截断（对标 `ganfan-garden`）**：
   - 在 `src/plugins/stage-reader/pagination.ts` 的 `applyPaginationStyles` 中，遍历 `body.querySelectorAll<HTMLElement>("img, svg, math, figure")` 计算并写入 `--pith-page-media-height`（扣除元素上下外边距后的 `contentHeightPx`），同时监听未加载完的 `<img>` `load` 事件重算分页页数；
   - 在 `src/shells/obsidian/plugin.ts`（`obsidianStyles`）与 `src/shells/web/server.ts` 的分页样式（`.pith-reader.pith-paged .pith-article` / `.reader.paged #article`）中强制加入：
     - `img, svg, math, figure { break-inside: avoid; page-break-inside: avoid; max-width: 100%; max-height: var(--pith-page-media-height, var(--pith-page-height)) !important; width: auto; height: auto; object-fit: contain; }`
     - 确保无论单栏还是双栏，任何插图或封面 SVG 都完整自适应在单页高度与栏宽内，绝不跨列截断或溢出视口。

2. **更换开启向导助手的专属图标（告别侧栏框撞车）**：
   - 将 `src/shells/obsidian/plugin.ts`（及 `src/shells/web/server.ts` 保持一致）顶栏的 `.pith-guide-toggle` SVG 替换为清晰的 **AI 向导对话气泡图标**（例如 Lucide `messages-square` 或对话气泡内嵌四芒星 SVG，绝不使用矩形分栏线 `rect + M15 4v16`），并在激活态（`aria-pressed="true"`）给予明确的主题强调色（`color: var(--pith-sage)` + 微底色反馈）。

3. **语音配置直达入口 + Obsidian 设置页完整语音配置与连接测试（对标 `ganfan-garden/src/settings.ts`）**：
   - **阅读页一键直达语音设置**：
     - 在 `ObsidianViewActions` 中新增可选 `openSettings?(): void`（在 `PithObsidianPlugin` 中通过 `(this.app as any).setting?.open()` 及 `openTabById?.("pith")` 打开插件设置面板）；
     - 当用户点击 `🎧` 因未配置或连接不上 TTS 服务失败时，提示条（`.pith-toast-tip`）不仅显示清晰中文原因，还附带一个可点击的 **`[⚙ 配置语音]`** 按钮（点击直达 Obsidian 的 Pith 设置页或 Web 壳的设置抽屉），且带操作按钮时停留时间延长至 5 秒。
   - **升级 `PithSettingTab`（`src/shells/obsidian/index.ts`）**：
     - 对齐 `ganfan-garden/src/settings.ts` 的清晰分组排版（卡片/小标题样式而非挤在一行裸 `<label>`），分区展示 **「工作区与向导 Agent」** 与 **「语音伴读 (TTS) 与跟读识别 (ASR)」**；
     - 支持在 Obsidian 设置页中填写并保存 `OPENAI_API_KEY` 与 `AZURE_SPEECH_KEY`（优先写入 Obsidian `app.secretStorage?.setSecret(...)`，并在 `createObsidianHostPort` 的 `secrets.getSecret` 中优先从 `app.secretStorage` 读取，再回退环境变量 `process.env`，严禁明文写入 Vault 同步文件）；
     - 在 Obsidian 设置页新增 **`[检测语音服务]`** 按钮（调用 `speech.tts.checkHealth()` / `speech.asr.checkHealth()` 实时反馈连接状态与具体指引）。

4. **多级树状可折叠目录（TOC Tree · 对标 `ganfan-garden/src/views/MaterialMap.ts`）**：
   - 根据 `sections` 的 `level` 层级（或 `epub.ts` 解析出的嵌套关系）构建真正的嵌套树结构（`<ul>` / `<li>`）：
     - 凡包含子章节的父节点，左侧渲染可点击的折叠开关按钮 `▸` / `▾`（`aria-expanded="false|true"`，点击仅切换子级 `<ul>.hidden` 而不关闭抽屉），叶子节点保留对齐占位；
     - 点击章节标题本体时跳转至对应页/锚点（在分页模式下精准计算目标元素水平偏移切换到对应页码屏！）并收起目录抽屉；
     - 打开目录抽屉时，自动根据当前阅读视口位置高亮当前所在章节（`aria-current="location"`），并自动展开其所有祖先章节节点、默认收起其他无关深层分支，避免长书几百条小节平铺刷屏。

### 验收标准（Tester）
- `npm run typecheck && npm test && npm run build:obsidian && npm run verify:obsidian` 全部零报错通过；
- `.dev-vault` 真实桌面 Obsidian 客户端实测核验以上 4 点：
  1. 分页模式下含大图/封面的页面 `max-height` 严格受限于页高且 `break-inside: avoid` 零截断；
  2. 顶栏向导按钮为对话气泡专属图标，与 Obsidian 侧边栏折叠图标明显区分；
  3. 点击 `🎧` 未连接语音时出现 `[⚙ 配置语音]` 按钮可一键打开 Pith 设置页，且设置页具备完整的 TTS/ASR 密钥存储与健康检测；
  4. 目录抽屉具备 `▸ / ▾` 多级树状折叠、当前章节高亮与分页精准跳转；
- 验收通过后，由 Router 将本文件更新为 `Status: verified`（附 `Verified-Commit`）并 `git commit` 收口。

---

## [Task #11] Wave 11：图标体系回归、一级/二级工具空间分层、顶部近源弹出修复、以及傻瓜化唯一标准设置面板

- **Status**: blocked
- **Verified-Commit**: none
- **Updated**: 2026-11-04
- **阻塞**：现有 `Topic.toolkits` 将未配置和明确清空均持久化为 `[]`，无法从已有数据区分；任务对显式清空后的默认工具行为亦需明确。请 Brain 冻结区分语义及旧数据处理方式，或明确两种空数组行为相同。云端 ASR 自定义端点目前受官方域名白名单保护，需明确端点、凭据与重定向安全契约后才能支持兼容网关。

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
  3. 无论窗口宽窄，点击 `[Aa]` 或实训工具均在顶栏右上方（`top: 44px; right`）近源弹出，绝不跑到底部；EPUB 章节间强制分页（`.pith-epub-chapter + .pith-epub-chapter { break-before: column }`），封面页底部不再出现“版权信息”标题；
  4. 打开设置页自动扫描并配置可用本机 Agent、修改即自动保存；语音设置不再暴露 Azure 分支，自定义端点/模型收纳在默认折叠的 `<details>` 中，且 `.dev-vault` 无 `e2e-*` 残留脏数据；
- 验收通过后，由 Router 仅将本 `[Task #11]` 区块更新为 `- **Status**: verified`（附 `Verified-Commit`）并 `git commit` 收口。
