# Pith · 核心版本重铸交接单（HANDOFF · 全量承接 Garden 字体/视觉/渲染资产 + Obsidian 真机 & EPUB/TTS 端到端闭环）

> **仓库路径**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **参考遗产母本（必读！）**：`/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden`
> **必读规范**：
> - [`ganfan-garden/styles.css`](/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/styles.css)（1,451 行精雕细琢的字体栈、配色语义变量、荧光黄高亮与阅读控件）
> - [`ganfan-garden/docs/product/prototype/interaction.html`](/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/docs/product/prototype/interaction.html)（视觉质感与排版呼吸感基准）
> - [`ganfan-garden/docs/PRODUCT.md`](/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/docs/PRODUCT.md)（尤其是第 38-51 行：**一级常驻体验保持极简通用，零特定学习法绑架**！）
> - [`docs/003-interaction.md`](003-interaction.md)

---

## 🚨 战略方向彻底纠偏（为什么必须重铸 UI、字体与真机阅读层）

上一轮快速原型犯了四个必须彻底推翻重铸的严重产品错误：
1. **丢掉了灵魂字体与排版质感**：丢掉了 `ganfan-garden` 的 **霞鹜文楷（`LXGW WenKai`）与宋/楷衬线阅读排版栈**（`--pith-serif: "Garden LXGW WenKai", "LXGW WenKai", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "Iowan Old Style", Georgia, serif`），把界面写成了粗糙简陋的工业灰框系统黑体，高亮甚至用了丑陋的灰底而不是温润的荧光笔黄（`rgba(235, 204, 102, 0.42)` + `#c59b38` 底边）！
2. **违背了「一级常驻体验零特定学习法绑架」铁律**：在所有课题（哪怕是读中文架构文章）的底部都强行硬编码常驻了 `🗣 4 阶跟读工坊` 按钮和像后台调试表单一样的粗糙文本框！**正确规则**：普通课题默认**只展示纯净阅读舞台 + 伴读按钮（`🎧 听读本章`）**；只有当向导 Agent（或课题 `topic.toolkits`）明确为该课题动态注入了某个实训工具（如外语课题注入了 `shadowing`）时，才按需出现对应的轻量实训入口！
3. **EPUB 电子书核心渲染能力未完整承接**：之前的 `epub.ts` 只提取了纯文本，丢掉了 EPUB 内嵌图片（Base64 / Blob URL 映射）、内嵌章节样式清洗与真正的章节按屏翻页体验。
4. **未进入真实电子书、真实 TTS 发声与 Obsidian 真机验收**：必须在导入真实 `.epub` 电子书、连接真实 Kokoro/云端 TTS 音频流播放、以及部署到 **Obsidian 真机** 的标准下由 ChatGPT Tester（CUA）完成验收。

---

## 📦 任务包拆分（2 个物理正交的 ChatGPT Worker 包 + 1 个 ChatGPT Tester 真机 CUA 验收包）

> **并行隔离铁律**：**Worker 1** 与 **Worker 2** 修改的文件集合 **100% 物理正交、零交集**，可同时派发给两个 ChatGPT Worker 并行推进；两者合拢后，交由 **ChatGPT Tester（CUA）** 在真实 EPUB、真实 TTS 服务与 Obsidian 真机上做终极验收。

---

### 🔨 Worker Package 1：字体资产 + 真 EPUB 图文/样式完整渲染引擎 + 种子电子书样本（`stage-reader` 深水区完整移植）

#### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- `src/plugins/stage-reader/lxgwWenKaiData.ts`（已由 Brain 从 `ganfan-garden` 原样拷入 11MB 完整霞鹜文楷 WOFF2 字库与 OFL 许可证，直接 import 复用，无需重新生成！）
- 新增 `src/plugins/stage-reader/fontData.ts`（基于 `./lxgwWenKaiData.ts` 实现 `installReaderFont(doc)`、导出 `READER_SERIF_STACK` 与 `@font-face` CSS 注入器）
- 修改 `src/plugins/stage-reader/epub.ts`
- 新增 `src/plugins/stage-reader/epubResources.ts`（EPUB 内嵌图片 data/blob URL 重写、安全 CSS 清洗与章节级结构保留）
- 修改 `src/plugins/stage-reader/index.ts`
- 新增真实多章节带封面/内嵌插图的测试电子书单测 `tests/core-epub-and-typography.test.ts`
- *(严禁修改 `src/core/**`、`src/shells/**`、`src/plugins/guide-acp/**`、`src/plugins/speech-service/**` 或旧测试文件！严禁在 `src/plugins/**` 中 import `node:*`！)*

#### 2. 核心实现要求
1. **找回霞鹜文楷（`LXGW WenKai`）与阅读排版字体内核（`fontData.ts`）**：
   - 检查 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/material/render/readerFont.ts`、`lxgwWenKaiData.ts` 及 `ganfan-garden/scripts/`（或系统/仓库字体资产），在 `stage-reader/fontData.ts` 中导出 `READER_SERIF_STACK`、`READER_SANS_STACK` 与 `installReaderFont(doc: Document)`，确保无论在 Obsidian 还是独立 Web 中，正文都能加载温润的霞鹜文楷 / 思源宋体 / 宋刻书卷排版，绝不退化成廉价系统黑体。
2. **真 EPUB 电子书图文与章节排版完整承接（`epub.ts` & `epubResources.ts`）**：
   - 对照 `ganfan-garden/src/material/ingest/epub.ts`、`src/material/render/adapters/epub.ts` 与 `epubStyles.ts`：
   - 保留 EPUB 原书章节语义结构（`<h1>..<h6>`, `<p>`, `<blockquote>`, `<ul>/<ol>`, `<table>`, `<figure>`, `<img>`, `<svg>`），彻底清理 `<script>` / `on*` 事件等危险节点；
   - **EPUB 内嵌图片 100% 正常显示**：解析章节相对路径（如 `../images/cover.png`），从 ZIP 包内提取对应图片字节并重写为安全的内嵌 `data:image/...;base64,...` URI，确保打开带插图或封面的 `.epub` 时图片 100% 清晰呈现；
   - 每个章节与正文段落精准输出 `data-locator` 与 `data-prose="true|false"`（图片/代码块/表格标为 `data-prose="false"`，自然语言段落标为 `data-prose="true"`），确保章节目录跳转与 TTS 全章连续伴读精准对齐。
3. **自检要求**：保证原有 73 项测试 + 新增 `tests/core-epub-and-typography.test.ts`（验证多章节含插图 `.epub` 完整渲染出图片、目录嵌套层级、章节分隔与正文伴读块提取）100% 通过。

---

### 🎨 Worker Package 2：承接 Garden 1,451 行高级视觉体系 + 砍掉常驻工坊绑架 + Obsidian 真机三栏体验打磨（`shells/obsidian` & `shells/web`）

#### 1. 唯一允许修改的文件范围（Write Scope · 严禁越界）
- 修改 `src/shells/obsidian/plugin.ts`
- 修改 `src/shells/obsidian/index.ts`
- 修改 `src/shells/web/server.ts`
- 修改 `scripts/build-obsidian.mjs`（确保打包进字体与完整 `styles.css`）
- 新增 `tests/core-ui-polish-and-obsidian.test.ts`
- *(严禁修改 `src/core/**`、`src/plugins/**`、`src/shells/dsh/**` 或旧测试文件！必须兼容保留现有测试断言的类名/ID 如 `.pith-left-drawer`, `.pith-bottom-dock`, `.pith-speech-active`, `.pith-toast-tip`, `#toggle-side`, `#agent-id`, `#detect-agents`！)*

#### 2. 核心实现要求（1:1 复刻 `ganfan-garden/styles.css` 与 `interaction.html` 的高级设计质感！）
1. **彻底消灭简陋工业风 UI，100% 注入 Garden 书卷级视觉设计语言**：
   - 仔细研读 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/styles.css` 与 `docs/product/prototype/interaction.html`，将其精髓完整移植到 `obsidianStyles`（`src/shells/obsidian/plugin.ts`）和 Web 壳样式（`src/shells/web/server.ts`）：
     - **工作区外框与侧栏跟随宿主主题变量**（`var(--background-primary)`、`var(--background-secondary)`，在 Web 壳提供温润细腻的中性浅/暗色默认值而非刺眼纯白 `#fff` + `#ddd` 粗黑线），同时引入细腻的鼠尾草绿强调色（`--pith-sage: #4e6a56` / 暗色 `#9bbfa2`）、陶土色徽章（`--pith-clay: #ad6548`）、柔和浮层阴影（`0 12px 32px rgba(24, 34, 29, 0.14)`）与圆润胶囊控件；
     - **正文排版恢复书卷气**：阅读器正文 `#article` / `.pith-article` 强制使用衬线书卷字体栈（`"Garden LXGW WenKai", "LXGW WenKai", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "Iowan Old Style", Georgia, serif`），字号 `17px`、行高 `1.95`、段间距 `1.15em`，支持 `Aa` 字号缩放与单页/双页并排自适应分页；
     - **荧光笔高亮与伴读微反应**：选区高亮 `<mark>` 采用温润荧光黄（`background: rgba(235, 204, 102, 0.38); border-bottom: 1.5px solid #c59b38`），当前朗读句 `.pith-speech-active` 采用鼠尾草绿柔和底色与精细下划线过渡。
2. **严格执行「一级常驻体验极简通用，零特定学习法绑架」**：
   - **砍掉普通课题底部常驻的 `🗣 4 阶跟读工坊` 突兀入口与简陋表单感！**
   - 当 `topic.toolkits` 为空（如普通阅读课题）时：底部悬浮条 `.pith-bottom-dock` **只显示纯净的伴读控制（`🎧 听读本章` + 播放中显示 `暂停 / 语速 1.0x / 进度`）**，绝不出现“跟读工坊”或“费曼复述”按钮干扰心流！（仅当 `topic.toolkits` 已被向导或用户显式挂载了 `shadowing` / `feynman` 时，才在 Dock 右侧优雅展示对应实训胶囊；若测试需要打开工坊，`#open-dojo` 可作为按需折叠的轻量次级图标或仅在挂载后展开精致卡片）。
3. **Obsidian 真机体验对标 `ganfan-garden/src/main.ts`**：
   - 在 `PithObsidianPlugin`（`src/shells/obsidian/index.ts`）中：
     - 打开 Pith 时支持完整的**花园/罗盘首页总览（卡片网格、15 分钟焦点行动推荐、新建 Topic、导入本地 `.epub/.pdf/.md` 材料文件）** $\leftrightarrow$ **课题沉浸阅读页（左上角 `[☰]` 左侧目录与多文件抽屉、按屏流畅翻页、框选悬浮三键+从此句起读、右侧可一键完全收起的向导 `[对话 | 笔记]` 侧栏）** 自由切换；
     - 在 Obsidian 中打开阅读视图时自动调用 `installReaderFont`（或注入衬线字体栈），并支持在 Obsidian 中直接选择 Vault 内或本机 `.epub` 文件导入阅读！

---

### 🔍 Tester Package（交给 ChatGPT App / CUA 执行终极真机验收，通过前不打扰用户）

在 Worker 1 和 Worker 2 全部合并并通过 `npm test` + `npm run build:obsidian` 后，执行以下 **三大真实验收关卡**：
1. **关卡 1：真实 `.epub` 电子书全链路验收**：
   - 导入一本真实多章节带插图的 `.epub` 电子书，验证：封面与插图显示、霞鹜文楷/衬线字体渲染、左上角 `[☰]` 抽屉章节树跳转、宽屏双页并排翻页（滚轮与方向键一致）、框选跨节点文字打上荧光黄高亮并跳回定位。
2. **关卡 2：真实神经网络 TTS 连续伴读验收（非 503 测试，真发声流验收！）**：
   - 在本机拉起真实兼容 `/v1/audio/speech` 的 TTS 语音端点（如本机 Kokoro 或配置的 OpenAI TTS），点按 `🎧 听读本章` 及框选某句点击 `▶ 从此句朗读`，验证：真实 `<audio>` 音频流连续播放、下一句无缝预取、`.pith-speech-active` 句级高亮跟随与跨页自动翻页、自动跳过代码块与图片。
3. **关卡 3：Obsidian 真机部署与 CUA 交互验收**：
   - 将构建好的 `dist/obsidian/{main.js, manifest.json, styles.css}` 部署到测试 Vault 的 `.obsidian/plugins/pith/`，在真实 **Obsidian 桌面端** 中启动启用插件，逐屏截图挑刺视觉细节（明暗主题切换、字体美感、抽屉与侧栏开合、零系统垃圾语音），确认达到核心可发布品质后再交付给用户。
