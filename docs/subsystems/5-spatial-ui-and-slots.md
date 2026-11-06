# 子系统 5：空间布局、视觉系统与工具槽位注入契约（Spatial UI & Slot Injection）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [3-dojos.md](3-dojos.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md)

---

## 1. 职责与五区空间拓扑（Five-Zone Spatial Topology）

Pith 的所有图形宿主壳（[`src/shells/obsidian/`](../../src/shells/obsidian/) 与 [`src/shells/web/`](../../src/shells/web/)）共享同一套空间秩序。工作台严格划分为 **5 个互斥的物理区域（Zones）**，严禁控件跨区侵占或遮挡正文画布：

```text
+---------------------------------------------------------------------------------------+
| [Zone 1: 44px 极简顶栏 Top Bar]                                                       |
| [☰ 目录] [‹ 返回]  课题标题 · 当前材料         ‹ 1/N ›  [🛠 工具胶囊] [🎧] [Aa] [? 向导]|
+-----------------------------------------------------------+---------------------------+
| ▲ (点击 [☰] 从左侧滑出导航抽屉 .pith-left-drawer：        | [Zone 4: 右侧向导栏 Guide]|
| │  合并展示【材料文件列表 + 可折叠目录树 TOC】，          |  • 顶栏切换：             |
| │  平时完全收起占 0px，正文头顶绝不放文件 Tab 条！)       |    [ 对话 | 笔记 N ]      |
|                                                           |  • 动态快捷胶囊区         |
| [Zone 2: 主视觉舞台 Primary Stage (flex: 1 · 纯净零遮挡)] |    (基础槽 + Dojo 贡献槽) |
|                                                           |  • 对话气泡 & 选项胶囊    |
|   • 书卷舞台 (stage-reader)：衬线书卷排版 / 多栏按屏分页  |    或 笔记卡片列表        |
|   • 时间轴舞台 (stage-timeline)：媒体画面 + 同步台词流    |  • 底部共用输入区：       |
|                                                           |    [ 选区引用预览 ]       |
|   ┌─ 2a. 框选悬浮条 Selection Popover (仅划选非空正文浮现)┐|    [ 消息框 + 🎙️ + 发送 ] |
|   │      [ 🟡 高亮 | 📝 记笔记 | 💬 问向导 | 📋 复制 ]   │|  (进入阅读默认收起占 0px，|
|   └──────────────────────────────────────────────────────┘|   按课题独立记忆开关状态) |
|                                                           |                           |
|   ┌─ 2b. 舞台原位变形层 In-Place Stage Lens ─────────────┐|                           |
|   │  • 行间双语 (interline)：段落下方直接长出译文行      │|                           |
|   │  • 实训道场 (shadowing/feynman)：目标块原位四阶变形  │|                           |
|   └──────────────────────────────────────────────────────┘|                           |
+-----------------------------------------------------------+---------------------------+
| [Zone 3: 底部唯一准入区 · 实心停靠播客甲板 Docked Media Deck (.pith-media-deck)]      |
| [▶/⏸]  01:24 / 08:45  ━━━━━━●────────────  [↺15s] [15s↻] [1.0x] [A-B] [跳回朗读处] [✕]|
+---------------------------------------------------------------------------------------+
```

### 五区准入硬边界

1. **Zone 1（44px 极简顶栏）**：
   - 左侧依次为 `[☰ 目录与材料抽屉]`、`[‹ 返回罗盘]`、课题/章节标题；
   - 右侧一级入口依次为：分页器 `< 1/N >`（仅按屏分页书籍显示）、已挂载的工具胶囊（`#open-dojo`，由 [`toolkitSlot`](../../src/shells/toolkitSlot.ts) 计算；`topic.toolkits` 为空时隐藏）、伴读开关 `🎧`、排版菜单 `Aa`、向导开关 `?`（`help-circle`）。
   - 点击 `[Aa]` 或顶栏工具胶囊时，轻量控制菜单紧贴顶栏右下方（`top: 100%; right: 8px`）近源展开，**严禁跑到屏幕底部或左下角弹出**。
2. **Zone 2（主视觉舞台 Stage & 左侧目录抽屉）**：
   - 课题下多文件切换与章节目录树（[`renderTocTree`](../../src/plugins/stage-reader/pagination.ts)）统一收纳在左侧滑出抽屉 `.pith-left-drawer` 中，当前阅读位置所在的目录项高亮（`aria-current="location"`）并自动展开其祖先节点，绝不在正文顶部渲染水平文件 Tab 条或内嵌 TOC 链接墙。
   - 框选非空正文时，选区上方弹出 `[ 高亮 | 记笔记 | 问向导 | 复制 ]` 四键悬浮条；点击 `记笔记` 或 `问向导` 自动展开右侧向导栏并切换至对应 `[笔记]` / `[对话]` 面板，同时将选区挂入底部引用预览。
3. **Zone 3（内容正下方唯一准入区：`.pith-media-deck`）**：
   - **内容正下方区域唯独只有音频播放控制条（`.pith-media-deck`）允许进入**！严禁在正文底部放置任何半透明悬浮条遮挡文字。
   - 当材料不含音频且未开启 `🎧` 伴读时，`.pith-media-deck` 完全隐藏（占 `0px`）；当材料含衍生/原生音频或正在执行 TTS 伴读时，在 Flexbox 底部**实心停靠**（挤压上方阅读容器高度，滑到页面最后一行也零遮挡）。
4. **Zone 4（右侧向导栏 Guide）**：
   - 从罗盘首页进入课题阅读页时，**右侧向导栏默认处于收起状态（占 `0px`，主阅读舞台 100% 居中撑满）**；
   - 用户手动点击顶栏 `?` 或通过框选 `问向导 / 记笔记` 唤出后，按 `topicId` 独立记忆该课题的侧栏开合状态，同课题内切换章节或文件时不乱跳。

---

## 2. 不同工具的多点位空间注入矩阵（Multi-Slot Toolkit Injection）

当向导通过 `topic.toolkits` 为课题动态挂载工具时，不同维度的工具按其物理属性分别投射到工作台的 **4 个挂载点**，拒绝将所有工具塞进同一个后台表单弹窗：

| 挂载槽位 | 1. 行间双语 (`dojo-interline`) | 2. 影子跟读 (`dojo-shadowing`) | 3. 费曼复述 (`dojo-feynman`) |
| :--- | :--- | :--- | :--- |
| **① 顶栏胶囊与近源轻开关**<br>*(Top Bar & Near-Source Popover)* | 顶栏显示 `[行间双语]`（多工具时显示聚合胶囊 `[🛠 2 个工具]`），近源菜单仅切换：`[ 原文 \| 行间双语 \| 译文主显 ]` | 顶栏显示 `[影子跟读]`，切换四阶镜头档位：`[ 意群拆解 \| 原文 \| 骨干词 \| 盲听 ]` | 顶栏显示 `[费曼复述]`，切换四阶脚手架档位：`[ 因果拆解 \| 原文 \| 概念挖空 \| 脱稿盲产 ]` |
| **② Stage 画布原位映射**<br>*(In-Place Stage Projection)* | **段落正下方内嵌行**：通过 [`InterlineView`](../../src/shells/interlineView.ts) 在每个 `[data-prose="true"]` 块内底部直接插入 `.pith-interline-subtitle[data-prose="false"]` | **目标字幕/段落原位变形**：点击 `.pith-cue` 或选中段落时，直接在目标文本上展示意群 `/`、功能词挖空 `___` 或盲听遮罩 `••••••••`，录入语音/文字后**直接标亮漏词（`<mark>`）**，不展示复制粘贴原文的「目标文本 `<textarea>`」 | **目标段遮罩与阐述输入**：锁定选中段落或当前章节核心段，在 `blind-produce` 下自动遮蔽原文并展示复述提示，仅提供单一阐述输入区（支持键盘与 `🎙️` 麦克风语音转写） |
| **③ 底部播客甲板联动**<br>*(Media Deck Sync)* | 译文块携带 `data-prose="false"`，甲板 TTS 伴读自动跳过译文只读外文原声 | 点击时间轴 `.pith-cue` 自动将甲板音频 `currentTime` 寻址到对应秒数，配合 A-B 循环与倍速跟练 | 实训阐述与录音期间保持甲板音频静默，避免声音干扰主动提取 |
| **④ 右侧向导栏联动**<br>*(Guide Sidebar Integration)* | - | 向导快捷栏动态注入 `[分析跟读]` 胶囊；支持将漏词对齐记录一键存为 `practice` 笔记 | 向导快捷栏动态注入 `[费曼深水区追问]` 胶囊；提交复述后直接携带 `evaluationRubric` 发往右侧向导对话流，触发**三明治苏格拉底追问**并落盘 `practice` 笔记 |

---

## 3. 跨设备连续几何自适应算法（[`resolveResponsiveLayout`](../../src/plugins/stage-reader/pagination.ts)）

系统不依赖死板的固定设备像素断点，而是根据工作区容器实时宽度 $W$、高度 $H$、长宽比 $R = W / H$、阅读区净宽及指针类型（`coarsePointer`）连续计算空间形态（输出 [`ResponsiveLayoutDecision`](../../src/core/seams.ts)）：

1. **右侧向导栏挂载形态（`canSplitGuide` & `sheetMode`）**：
   - **`"split-right"`（桌面/平板/折叠屏展开横宽态）**：当且仅当同时满足 $W \ge 420 + W_{\text{guide}}$、长宽比 $R \ge 0.85$ 且高度 $H \ge 480\text{px}$ 时，允许右侧向导与主舞台左右并排分栏；
   - **`"bottom-sheet"`（手机竖屏或窄竖窗，$R < 0.85$ 或 $W < 600\text{px}$）**：严禁左右并排挤压正文，向导面板以底部上滑圆角抽屉（Bottom Sheet）形态挂载；
   - **`"overlay-drawer"`（手机横屏 $H < 480\text{px}$ 或中等窄窗）**：以右侧覆盖抽屉形态滑出，不触发底下阅读版心重排。
2. **多栏分页上限（`maxColumns` & `effectiveColumns`）**：
   - 根据扣除向导栏后的阅读器实际净宽计算每栏扣除边距后的可用宽度，仅当每栏净宽满足最小可读阈值时才解锁 `双栏` 或 `三栏` 按钮（无法容纳的档位自动 `disabled` 置灰）。
3. **触控热区与安全区（`hitTargetPx`）**：
   - 粗指针设备（`coarsePointer: true`）或手机形态下，`hitTargetPx = 44`（顶栏与播客甲板按钮最小点击尺寸自动扩大至 `44px × 44px`，底部自动留出 `env(safe-area-inset-bottom)`）；精细鼠标桌面端为 `34`。

---

## 4. 宿主原生主题继承与书卷视觉体系（Visual System）

1. **100% 跟随宿主主题变量（Host-Native Theme Inheritance）**：
   - 外框、顶栏、目录抽屉、向导栏与卡片背景统一消费宿主 CSS 变量（`--background-primary`、`--background-secondary`、`--background-modifier-border`、`--background-modifier-hover`、`--text-normal`、`--text-muted`、`--text-faint`、`--font-interface`），确保在 Obsidian 浅色/暗色主题下与原生窗口浑然一体，严禁硬编码死板的全局暖黄纸底导致“左右两张皮”割裂；
   - 品牌语义点缀色通过双主题变量注入：浅色模式 `--pith-sage: #4e6a56`（探索中/激活态鼠尾草绿）、`--pith-clay: #ad6548`（已沉淀陶土色）；暗色模式自动切换为 `--pith-sage: #9bbfa2`、`--pith-clay: #d88d70`。
2. **书卷衬线字体栈与微反应样式**：
   - 阅读舞台正文（`.pith-article` / `#article`）默认注入内嵌的霞鹜文楷与宋楷衬线栈（[`READER_SERIF_STACK`](../../src/plugins/stage-reader/fontData.ts)：`"Garden LXGW WenKai", "LXGW WenKai", "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", "Iowan Old Style", Georgia, serif`）；
   - 选区高亮 `<mark>` 采用柔和荧光黄底边样式（`background: rgba(235, 204, 102, 0.38); border-bottom: 1.5px solid #c59b38`）；
   - 当前正在朗读的句子（`.pith-speech-active`）采用鼠尾草绿柔和底色与呼吸下划线微反应（尊重 `prefers-reduced-motion: reduce` 自动关闭动画）。
3. **非阻塞反馈（Zero Blocking Dialogs）**：
   - 全仓 UI 严禁调用阻塞式的 `window.alert()`；所有操作提示、非正文伴读提示与错误引导统一通过自动淡出的 `.pith-toast-tip`（`role="status"`）或内联状态区呈现。

---

## 5. 验证命令

```bash
node --experimental-strip-types --test tests/track3-spatial-ui-and-obsidian.test.ts tests/wave7-responsive-and-media-deck.test.ts tests/wave11-popover-browser.test.ts
```
