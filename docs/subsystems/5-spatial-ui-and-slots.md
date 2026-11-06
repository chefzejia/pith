# 子系统 5：统一图形工作台、空间布局与槽位注入（`src/workbench/`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [3-dojos.md](3-dojos.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md)

---

## 1. 职责与五区空间拓扑（Five-Zone Spatial Topology）

Pith 的所有宿主壳（[`src/shells/obsidian/`](../../src/shells/obsidian/)、[`src/shells/web/`](../../src/shells/web/) 与 [`src/shells/dsh/`](../../src/shells/dsh/)）统一挂载同一份 `src/workbench/` 图形工作台。工作台严格划分为 **5 个互斥的物理区域（Zones）**，严禁控件跨区侵占或遮挡正文画布：

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
|   │  • 实训道场 (shadowing/feynman)：目标块原位内联实训  │|                           |
|   └──────────────────────────────────────────────────────┘|                           |
+-----------------------------------------------------------+---------------------------+
| [Zone 3: 底部唯一准入区 · 实心停靠播客甲板 Docked Media Deck (.pith-media-deck)]      |
| [▶/⏸]  01:24 / 08:45  ━━━━━━●────────────  [↺15s] [15s↻] [1.0x] [A-B] [跳回朗读处] [✕]|
+---------------------------------------------------------------------------------------+
```

### 五区准入硬边界

1. **Zone 1（44px 极简顶栏）**：
   - 左侧依次为 `[☰ 目录与材料抽屉]`、`[‹ 返回课题看板]`、课题/章节标题；
   - 右侧一级入口依次为：分页器 `< 1/N >`（仅按屏分页书籍显示）、已挂载的工具胶囊（`#open-dojo`；`topic.toolkits` 为空时隐藏）、伴读开关 `🎧`、排版菜单 `Aa`、向导开关 `?`。
   - 点击 `[Aa]` 或顶栏工具胶囊时，轻量控制菜单紧贴顶栏右下方近源展开，**严禁跑到屏幕底部或左下角弹出**。
2. **Zone 2（主视觉舞台 Stage & 左侧目录抽屉）**：
   - 课题下多文件切换与章节目录树（[`renderTocTree`](../../src/plugins/stage-reader/pagination.ts)）统一收纳在左侧滑出抽屉 `.pith-left-drawer` 中，当前阅读位置所在的目录项高亮（`aria-current="location"`）并自动展开其祖先节点，绝不在正文顶部渲染水平文件 Tab 条或内嵌 TOC 链接墙。
   - 框选非空正文时，选区上方弹出 `[ 高亮 | 记笔记 | 问向导 | 复制 ]` 四键悬浮条；点击 `记笔记` 或 `问向导` 自动展开右侧向导栏并切换至对应 `[笔记]` / `[对话]` 面板，同时将选区挂入底部引用预览。
3. **Zone 3（内容正下方唯一准入区：`.pith-media-deck`）**：
   - **内容正下方区域唯独只有音频播放控制条（`.pith-media-deck`）允许进入**！严禁在正文底部放置任何半透明悬浮条遮挡文字。
   - 当材料不含音频且未开启 `🎧` 伴读时，`.pith-media-deck` 完全隐藏（占 `0px`）；当材料含衍生/原生音频或正在执行 TTS 伴读时，在 Flexbox 底部**实心停靠**（挤压上方阅读容器高度，滑到页面最后一行也零遮挡）。
4. **Zone 4（右侧向导栏 Guide）**：
   - 从课题看板首页进入课题阅读页时，**右侧向导栏默认处于收起状态（占 `0px`，主阅读舞台 100% 居中撑满）**；
   - 用户手动点击顶栏 `?` 或通过框选 `问向导 / 记笔记` 唤出后，按 `topicId` 独立记忆该课题的侧栏开合状态，同课题内切换章节或文件时不乱跳。

---

## 2. 不同工具的多点位空间注入矩阵（Multi-Slot Toolkit Injection）

当向导通过 `topic.toolkits` 为课题动态挂载工具时，不同维度的工具按其物理属性分别投射到工作台的 **4 个挂载点**，拒绝将所有工具塞进同一个后台表单弹窗：

| 挂载槽位 | 1. 输入降噪 (`dojo-interline`) | 2. 程序性跟练 (`dojo-shadowing`) | 3. 生成式复述 (`dojo-feynman`) |
| :--- | :--- | :--- | :--- |
| **① 顶栏胶囊与近源轻开关**<br>*(Top Bar & Near-Source Popover)* | 顶栏显示 `[行间双语]`（多工具时显示聚合胶囊），近源菜单仅切换：`[ 原文 \| 行间双语 \| 译文主显 ]` | 顶栏显示 `[影子跟读]`，近源轻菜单仅用于切换多工具或退出跟读 | 顶栏显示 `[费曼复述]`，近源轻菜单仅用于开启/退出当前段落复述态 |
| **② Stage 画布原位映射**<br>*(In-Place Stage Projection)* | **段落正下方内嵌行**：通过 [`InterlineView`](../../src/plugins/dojo-interline/view.ts) 在每个 `[data-prose="true"]` 块内底部直接插入 `.pith-interline-subtitle[data-prose="false"]` | **目标字幕/段落原位四阶变形**：点击 `.pith-cue` 或选中段落时，**直接在画布目标块原位**展开内联跟读条（含 `[ 意群拆解 \| 原文 \| 骨干词 \| 盲听 ]` 镜头切换 + `🎙️` 语音/文本输入 + 原位 `<mark>` 漏词标亮），绝不在右上角弹出第二个正文框 | **目标段原位遮罩与阐述条**：无需四阶段按钮！直接在画布目标段落原位将其平滑折叠/遮罩（“合上原文”），紧贴该段下方内联展开阐述输入区（支持键盘与 `🎙️` 麦克风语音转写）及 `[提交复述并请向导追问]` 按钮 |
| **③ 底部播客甲板联动**<br>*(Media Deck Sync)* | 译文块携带 `data-prose="false"`，甲板 TTS 伴读自动跳过译文只读外文原声 | 点击时间轴 `.pith-cue` 自动将甲板音频 `currentTime` 寻址到对应秒数，配合 A-B 循环与倍速跟练 | 实训阐述与录音期间保持甲板音频静默，避免声音干扰主动提取 |
| **④ 右侧向导栏联动**<br>*(Guide Sidebar Integration)* | - | 向导快捷栏动态注入 `[分析跟读]` 胶囊；支持将漏词对齐记录一键存为 `practice` 笔记 | 向导快捷栏动态注入 `[费曼深水区追问]` 胶囊；提交复述后直接携带 `evaluationRubric` 发往右侧向导对话流，触发**三明治苏格拉底追问**并落盘 `practice` 笔记 |

---

## 3. 跨设备连续几何自适应算法（[`resolveResponsiveLayout`](../../src/plugins/stage-reader/pagination.ts)）

系统不依赖死板的固定设备断点，而是根据工作区容器实时宽度、高度、长宽比、阅读区净宽及指针类型（`coarsePointer`）连续计算空间形态（输出 [`ResponsiveLayoutDecision`](../../src/core/seams.ts)）：

1. **右侧向导栏挂载形态（`canSplitGuide` & `sheetMode`）**：
   - **`"split-right"`（桌面/平板/折叠屏展开横宽态）**：当容器净宽、长宽比与高度同时满足并排可读阈值时，允许右侧向导与主舞台左右并排分栏；
   - **`"bottom-sheet"`（竖屏或窄竖窗）**：严禁左右并排挤压正文，向导面板以底部上滑圆角抽屉（Bottom Sheet）形态挂载；
   - **`"overlay-drawer"`（横屏矮窗或中等窄窗）**：以右侧覆盖抽屉形态滑出，不触发底下阅读版心重排。
2. **多栏分页上限（`maxColumns` & `effectiveColumns`）**：
   - 根据扣除向导栏后的阅读器实际净宽计算每栏可用宽度，仅当每栏净宽满足最小可读阈值时才解锁 `双栏` 或 `三栏` 按钮（无法容纳的档位自动 `disabled` 置灰）。
3. **触控热区与安全区（`hitTargetPx`）**：
   - 粗指针设备（`coarsePointer: true`）下自动扩大顶栏与播客甲板按钮最小点击尺寸，并预留底部安全区内边距（`env(safe-area-inset-bottom)`）。

---

## 4. 宿主原生主题继承与书卷视觉体系（Visual System）

1. **100% 跟随宿主主题变量（Host-Native Theme Inheritance）**：
   - 外框、顶栏、目录抽屉、向导栏与卡片背景统一消费宿主 CSS 变量（`--background-primary`、`--background-secondary`、`--background-modifier-border`、`--background-modifier-hover`、`--text-normal`、`--text-muted`、`--text-faint`、`--font-interface`），确保在浅色/暗色主题下与原生窗口浑然一体，严禁硬编码死板的全局纸底色导致割裂；
   - 品牌语义点缀色（探索态 `--pith-sage` 与沉淀态 `--pith-clay`）通过亮暗双主题 CSS 变量自适应注入。
2. **书卷衬线字体栈与微反应样式**：
   - 阅读舞台正文（`.pith-article` / `#article`）默认注入内嵌的衬线字体栈（[`READER_SERIF_STACK`](../../src/plugins/stage-reader/fontData.ts)）；
   - 选区高亮 `<mark>` 与当前正在朗读的句子（`.pith-speech-active`）采用柔和底色与下划线微反应（尊重 `prefers-reduced-motion: reduce` 自动关闭动画）。
3. **非阻塞反馈（Zero Blocking Dialogs）**：
   - 全仓 UI 严禁调用阻塞式的 `window.alert()`；所有操作提示、非正文伴读提示与错误引导统一通过自动淡出的 `.pith-toast-tip`（`role="status"`）或内联状态区呈现。

---

## 5. 验证命令

```bash
node --experimental-strip-types --test tests/track3-spatial-ui-and-obsidian.test.ts tests/wave7-responsive-and-media-deck.test.ts tests/wave11-popover-browser.test.ts
```
