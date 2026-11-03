# Pith · 跨设备连续几何自适应算法、顶栏弹性工具槽与实心播客甲板交接单（HANDOFF · Wave 7）

> **仓库路径**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **必读最新契约**：[`AGENTS.md`](../AGENTS.md) · [`docs/003-interaction.md`](003-interaction.md) · [`src/core/seams.ts`](../src/core/seams.ts)
> **硬性红线回顾**：
> - 严禁触碰用户真实 Vault（`ganfan-media` / `Downloads`），Obsidian 真机测试唯一固定使用 `/Users/zejiawu/Projects/Project-Atlas/labs/pith/.dev-vault`；
> - 严禁调用废弃的 `Qwen3-TTS` 或系统自带 `say`/`SiriTTS`/`speechSynthesis`。

---

## 🎯 Wave 7 三大核心架构目标（对齐 [`docs/003-interaction.md`](003-interaction.md) & [`src/core/seams.ts`](../src/core/seams.ts)）

### 1. 跨设备连续几何自适应算法（`resolveResponsiveLayout` in `src/plugins/stage-reader/pagination.ts` & `index.ts`）
实现并挂载 [`src/core/seams.ts`](../src/core/seams.ts) 中定义的 `StageReaderService.resolveResponsiveLayout(input): ResponsiveLayoutDecision`，用一套纯几何方程同时解决 **直板手机、折叠屏（展开接近正方形 `R ~ 0.9`）、iPad 分屏、Obsidian 窄窗格与桌面宽屏** 的动态自适应：

1. **输入参数**：
   `{ width: W, height: H, fontSizePx = 17, guideOpen = false, guideWidthPx = 320, preferredColumns = "auto", coarsePointer = false }`
2. **形态分类（`formFactor`）与长宽比 $R = W / \max(1, H)$**：
   - 若 $R < 0.85$ 或 $W < 600$：`formFactor = "portrait-phone"`；
   - 否则若 $H < 480$：`formFactor = "landscape-phone"`；
   - 否则若 $R < 1.18$ 且 $W < 960$：`formFactor = "foldable-square"`（折叠屏展开态 / 方屏）；
   - 否则：`formFactor = "tablet-desktop"`。
3. **法则 A：工作区「左右分栏 vs 底部/侧边抽屉」判定（`canSplitGuide` & `sheetMode`）**：
   - 充要条件：`canSplitGuide = (W >= 420 + guideWidthPx) && (R >= 0.85) && (H >= 480)`（即 $W \ge 740, R \ge 0.85, H \ge 480$）；
   - 当 `canSplitGuide === true` 时，`sheetMode = "split-right"`（允许左书右师并排分栏，折叠屏展开态 $780 \times 860$ 天然命中此模式！）；
   - 当 `canSplitGuide === false` 时：**彻底禁止左右并排分栏**！若 $R < 0.85$ 或 $W < 600$ 则 `sheetMode = "bottom-sheet"`（手机竖屏从底部弹出半屏/全屏卡片），否则 `sheetMode = "overlay-drawer"`（窄横屏/小窗以右侧浮层滑出，不挤压正文）。
4. **法则 B：书本正文「单栏 vs 双页并排（Two-Page Spread）」黄金比例判定（`canDoubleColumn` & `effectiveColumns`）**：
   - 计算主阅读舞台净宽：`stageWidthPx = (guideOpen && canSplitGuide) ? Math.max(1, W - guideWidthPx) : W`；
   - 计算舞台长宽比：$R_{\text{stage}} = \text{stageWidthPx} / \max(1, H)$；
   - **双栏充要条件**：`canDoubleColumn = (stageWidthPx >= 936) && (R_stage >= 1.15) && (H >= 520)`；
     - *物理意义*：① 两栏每栏至少 420px（24 个汉字）+ 边距；② 舞台必须明显宽于高（$R_{\text{stage}} \ge 1.15$，拒绝在正方形折叠屏上切成难看的细长面条双栏）；③ 高度至少 520px（拒绝在手机横屏上切成火柴盒矮栏）。
     - *侧栏开合实时联动*：当用户在笔记本窗口（如 $1150 \times 800$）打开右侧 320px 向导栏时，`stageWidthPx` 从 $1150$ 降为 $830 < 936$，`canDoubleColumn` 立即变为 `false`，`effectiveColumns` **自动从 2 降级回 1（单页舒适排版）**；关闭向导栏后自动恢复为 2！
   - `effectiveColumns`: 若 `!canDoubleColumn` 或 `preferredColumns === "single"` 则为 `1`，否则若 `preferredColumns === "double"` 或 `preferredColumns === "auto"` 则为 `2`。
5. **法则 C：触控热区（`hitTargetPx`）**：
   - 当 `coarsePointer === true` 或 `formFactor === "portrait-phone"` 或 `formFactor === "landscape-phone"` 时，`hitTargetPx = 44`，否则 `34`。

---

### 2. 顶栏「单一弹性工具胶囊槽（`[✦ 工具名 · N ▾]`）」设计（`shells/obsidian` & `shells/web`）
解决“未来 Agent 动态注入多个实训工具时怎么扩展才不挤爆 44px 顶栏”的问题：
1. **永远只占 1 个弹性胶囊槽位**：
   - 当 `topic.toolkits.length === 0` 时：只显示极轻量的次级 `+` 按钮（`#open-dojo.pith-dojo-add`）；
   - 当 `topic.toolkits.length === 1` 时（如 `["feynman"]`）：显示单枚鼠尾草绿微光胶囊 `✦ 费曼复述`；
   - 当 `topic.toolkits.length >= 2` 时（如 `["shadowing", "feynman"]`）：**绝不在顶栏排成多个按钮**，而是聚合显示为单枚胶囊 `✦ 影子跟读 · 2 ▾`（显示当前激活工具名 + 已挂载总数角标 `· N ▾`，点击打开面板并在面板顶部自由切换或挂载更多工具）。

---

### 3. 衍生音频资产检测与「底部实心停靠播客甲板（`.pith-media-deck`）」+ 移动端 Bottom Sheet 适配
支持“PC 端离线将文章/播客渲染为音频文件放入材料目录 $\rightarrow$ 跨端同步到手机/Obsidian $\rightarrow$ 打开材料检测到音频自动浮现播客控制条”的完整闭环：
1. **自动检测材料中的音频资产（Audio Asset Auto-Detection）**：
   - 在 `shells/web` 与 `shells/obsidian` 打开课题材料时，检查 `material.files` 是否包含音频文件（`.mp3`, `.m4a`, `.wav`, `.ogg`, `.aac`, `.flac` 或 `mimeType.startsWith("audio/")`），并在 Web 壳提供 `GET /api/materials/:id/raw?name=<file>` 二进制流读取路由（支持 `audio/*` Content-Type）；
   - 当材料包含现成音频文件（例如 PC 端离线合成同步过来的播客音频）**或**用户点击顶栏 `[🎧]` 开启 TTS 伴读时，自动激活底部实心停靠的 **`.pith-media-deck`（播客控制甲板）**！
2. **实心停靠播客甲板（`.pith-media-deck` · 100% 零正文遮挡）**：
   - 采用 Flexbox 底部实心停靠布局（位于 `.pith-stage` / `.reader-wrap` 底部，挤压上方滚动区高度，**绝不用 `position: absolute` 半透明盖在正文字上**！纯文本且未播放时 `hidden` 占 0px）；
   - 内含完整播客级控件：`[▶/⏸ 播放暂停]`、时间与进度条（`<input type="range" class="pith-media-seek">` 或章节进度）、`[↺ 15s]`、`[15s ↻]`、倍速切换（`0.75x / 1.0x / 1.25x / 1.5x / 2.0x`）、以及 `[✕ 收起]`；
   - 当存在配套字幕（`.vtt/.srt`）或正文段落时，播放进度与 `.pith-cue` / `.pith-speech-active` 实时联动，点击字幕行可直接跳转音频时间点（`audio.currentTime = cue.startSec`）！
3. **响应式容器联动（`ResizeObserver` -> `resolveResponsiveLayout`）**：
   - 在 `PithObsidianView` 与 Web 壳中，通过 `ResizeObserver` 监听容器宽高 $(W, H)$ 与右侧向导开关状态，实时调用 `resolveResponsiveLayout`：
     - 将 `data-form-factor="portrait-phone|landscape-phone|foldable-square|tablet-desktop"` 与 `data-sheet-mode="split-right|bottom-sheet|overlay-drawer"` 写入根容器；
     - 当 `sheetMode === "bottom-sheet"`（手机竖屏）时，向导栏（`.pith-guide` / `.side`）、实训面板（`.pith-dojo-panel` / `.training-panel`）与 `[Aa]` 气泡自动切换为底部圆角上滑抽屉样式（`position: fixed/absolute; left: 0; right: 0; bottom: 0; max-height: 75vh; border-radius: 16px 16px 0 0`），彻底消灭手机竖屏下的左右窄分栏！
     - 当 `canDoubleColumn === false`（如手机竖屏、折叠屏方屏、或展开右侧向导后剩余舞台宽度不足 936px）时，若用户原本处于 `double` 双栏模式，自动降级为单栏排版并在 `[Aa]` 菜单中将“双页分页”按钮设为 `disabled`（待窗口变宽或收起向导后自动恢复双栏）。

---

## 📦 测试与验收要求（`tests/wave7-responsive-and-media-deck.test.ts`）

1. **几何算法完备性单测**：
   - 精确验证 `resolveResponsiveLayout` 在 5 种典型几何形态下的输出：
     - 手机竖屏（`390x844`）：`formFactor: "portrait-phone"`, `canSplitGuide: false`, `sheetMode: "bottom-sheet"`, `canDoubleColumn: false`, `effectiveColumns: 1`, `hitTargetPx: 44`；
     - 手机横屏（`844x390`）：`formFactor: "landscape-phone"`, `canSplitGuide: false`, `sheetMode: "overlay-drawer"`, `canDoubleColumn: false`（因 $H < 520$）；
     - 折叠屏展开方屏（`780x860`）：`formFactor: "foldable-square"`, `canSplitGuide: true`（解锁“左书右师”分栏！）, `sheetMode: "split-right"`, `canDoubleColumn: false`（因 $R = 0.91 < 1.15$，拒绝切成面条双栏）；
     - 笔记本中等宽屏（`1150x800`）：`guideOpen: false` 时 `canDoubleColumn: true, effectiveColumns: 2`；当切换为 `guideOpen: true` 时，剩余舞台宽 `830 < 936`，自动触发 `canDoubleColumn: false, effectiveColumns: 1`！
     - 桌面超宽屏（`1440x900`）：即使 `guideOpen: true`（剩余舞台宽 `1120 >= 936` 且 $R_{\text{stage}} = 1.24 \ge 1.15$），依然保持 `canDoubleColumn: true, effectiveColumns: 2`！
2. **顶栏单一弹性工具槽与实心播客甲板单测**：
   - 验证挂载 0 个、1 个（`✦ 费曼复述`）、2 个工具（`✦ 影子跟读 · 2 ▾`）时的单一胶囊聚合表现；
   - 验证材料含 `.mp3/.wav` 音频文件时，`.pith-media-deck` 实心停靠播客条自动显现并支持 `±15s` 快进快退与倍速控制。
3. **构建与真机同步**：
   - 运行 `npm run typecheck`、`npm test`、`npm run build:obsidian` 确保全仓测试 100% 全绿，并将最新构建同步至 `.dev-vault/.obsidian/plugins/pith/`。
