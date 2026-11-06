# 子系统 2：预训练阅读与媒体舞台（`stage-reader` & `stage-timeline`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [3-dojos.md](3-dojos.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 职责与边界

对应人类认知训练管线的 **第 1 阶段：预训练（Pre-training · 一手原始语料摄入）**。

Pith 拒绝用一键 AI 摘要代替原著阅读。舞台子系统的任务是把书籍（EPUB / PDF / CBZ / Markdown）与音视频播客直接呈现在零干扰的画布上，并为每一段正文赋予**与屏幕尺寸、字号无关的内在坐标（`IntrinsicLocator`）**，供高亮、笔记、语音伴读与实训道场精准锚定。

```text
src/plugins/
├── stage-reader/             # 书卷阅读舞台（提供服务 "stage.reader"）
│   ├── index.ts              # Markdown 块解析、正文提取（extractProseBlocks）与插件注册
│   ├── epub.ts               # EPUB ZIP 解包、HTML/SVG 净化、章节拼装与内部链接解析（resolveEpubTarget）
│   ├── epubResources.ts      # EPUB CSS 净化、路径规范化与内联图片 Data URL 转换
│   ├── fixedPage.ts          # PDF / CBZ / Image 固定版面分页解析
│   ├── pagination.ts         # 1/2/3 栏黄金版心计算、响应式断点决策与无滚动条翻页控制
│   ├── textAnchor.ts         # 选区文本锚点匹配（locator + quote + prefix/suffix）
│   ├── teachingBlocks.ts     # 讲义内嵌教学块（reflection / hint / checkpoint / explanation）提取
│   └── fontData.ts           # 阅读器字体栈与落霞孤鹜文楷（lxgwWenKaiData.ts）注入
└── stage-timeline/           # 时间轴媒体舞台（提供服务 "stage.timeline"）
    └── index.ts              # WebVTT / SRT / 时间戳字幕解析、时间游标查找与 A-B 区间切片
```

---

## 2. 内在位置坐标系（`IntrinsicLocator`）与选区锚定

无论用户在宽屏桌面还是窄屏窗口打开同一份材料，也无论切换单栏、双栏还是调大字号，阅读进度与笔记锚点始终通过内在坐标恢复：

| 材料形态 | 坐标格式示例 | 解析与生成位置 |
| :--- | :--- | :--- |
| **Markdown 文档/讲义** | `text:line:42`（叠加句内偏移：`text:line:42;offset:18`） | [`stage-reader/index.ts`](../../src/plugins/stage-reader/index.ts) 中的 `markdownBlocks` |
| **EPUB 重排章节** | `epub:chapter:2;block:5`（章节号 + 块序号） | [`stage-reader/epub.ts`](../../src/plugins/stage-reader/epub.ts) 中的 `renderEpub` |
| **PDF / CBZ / 固定版 EPUB** | `page:12` | [`stage-reader/fixedPage.ts`](../../src/plugins/stage-reader/fixedPage.ts) 中的 `renderPdf` / `renderCbz` |
| **音视频字幕流** | `time:860`（秒级起点） | [`stage-timeline/index.ts`](../../src/plugins/stage-timeline/index.ts) 中的 `parseTranscript` |
| **代码仓库文件** | `repo:<commitSha>:<path>#L<start>-L<end>` | [`src/core/types.ts`](../../src/core/types.ts) 中的 `IntrinsicLocator` |

- **正文与非正文严格标记（`data-prose`）**：标题、普通段落、引文标记为 `data-prose="true"`；代码块、数学公式、表格、YAML Frontmatter、教学卡片以及行间双语嵌入的译文节点一律标记为 `data-prose="false"`。下游 TTS 伴读仅提取 `data-prose="true"` 的纯粹原文朗读。
- **内嵌教学块协议（[`extractTeachingBlocks`](../../src/plugins/stage-reader/teachingBlocks.ts)）**：识别讲义中的 ````pith-teaching` / ````garden-teaching` 围栏块与 `> [!reflection|hint|checkpoint|explanation]` Callout，渲染为 `<section class="pith-teaching-block" data-teaching-kind="..." data-locator="text:line:<n>" data-prose="false">`，供向导在定制讲义中插入思考卡、提示与自测锚点而不被 TTS 误读。
- **文本重定位容错（[`matchTextAnchor`](../../src/plugins/stage-reader/textAnchor.ts)）**：优先按 `locator` 精确匹配，当文本前部发生插入/删除导致偏移漂移时，回退至 `quote + prefix + suffix` 上下文匹配度与最小距离评分重定位。

---

## 3. EPUB 净化与跨章链接解析（`epub.ts`）

1. **容量与安全边界（Fail-Closed）**：[`Zip`](../../src/plugins/stage-reader/epub.ts) 对单文件与整书解压字节数执行硬性上限检查，防止压缩包炸弹耗尽内存。
2. **保留命名空间剥离**：净化原书 HTML 时，强制剥离原书中任何以 `pith-` 开头的伪造类名及宿主保留 `data-*` 属性，确保章节容器查询（`section.pith-epub-chapter[data-epub-chapter]`）100% 命中真实章节节点，绝不被原书脏标签劫持。
3. **同章与跨章链接跳转**：[`resolveEpubTarget`](../../src/plugins/stage-reader/epub.ts) 将原书目录与正文内的相对路径、`#fragment` 锚点解析为目标章节下标与重写后的安全 DOM ID（`pith-epub-id-<chapter>-<id>`），支持点击目录或正文脚注直接翻至目标屏。

---

## 4. 黄金版心多栏分页恒等式（`pagination.ts`）

电子书（`epub / pdf / cbz`）采用**零横向滚动条的按屏分页模式**（`overflow: hidden`，通过滚轮、方向键或顶栏 `< 1/N >` 翻页）：

1. **栏数自适应与黄金行宽**：
   - [`resolveResponsiveLayout`](../../src/plugins/stage-reader/pagination.ts) 根据阅读容器实时净宽判定最大可读栏数；
   - [`computePagination`](../../src/plugins/stage-reader/pagination.ts) 按栏数约束最大舒适列宽。在超宽屏下选择单栏或多栏时，多余宽度自动均分至两侧水平留白 `horizontalInsetPx`，使版心在视口内水平居中。
2. **多屏翻页步长恒等式**：
   - 为确保每次向右滚动一个 `viewportWidth`（`scrollLeft = pageIndex * viewportWidth`）都能像素级对齐下一屏的首列，列宽 `columnWidthPx`、列间距 `columnGapPx` 与水平内边距 `horizontalInsetPx` 恒满足：
     $$\text{columnGapPx} = 2 \times \text{horizontalInsetPx}$$
     $$\text{columns} \times (\text{columnWidthPx} + \text{columnGapPx}) \equiv \text{viewportWidth}$$
3. **跨列字符测量与缩放锚点保护**：
   - 测量跨列段落的位置时，通过 `range.getClientRects()` 过滤宽高非零的真实字符片段（避免 `getBoundingClientRect()` 返回跨列合并外框）；
   - 窗口连续拖拽缩放触发 `ResizeObserver` 重排时，直接恢复缩放前的锚点位置，不以重排途中的中间态覆盖原锚点。

---

## 5. 时间轴媒体舞台与跨模态伴读（`stage-timeline`）

1. **复合媒体视图结构（[`renderTimelineView`](../../src/plugins/stage-timeline/index.ts)）**：
   - 当材料为视频（`mediaKind === "video"`）或音频时，画布呈现为「上方媒体画面/状态区 + 下方带时间锚点的同步台词流（`.pith-cue[data-locator="time:<sec>"][data-prose="true"]`）」，同时联动底部实心停靠播客甲板（`.pith-media-deck`，详见 [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)）；
   - 用户可直接用鼠标框选任意时间轴台词触发 `[ 高亮 | 记笔记 | 问向导 | 复制 ]`，生成的 `SelectionAnchor` 自动绑定 `locator: "time:<sec>"`；日后在右侧向导 `[笔记]` 账本中点击该卡片，播放器与视图直接跳回对应秒数。
2. **字幕解析与 A-B 循环切片**：
   - [`parseTranscript`](../../src/plugins/stage-timeline/index.ts) 统一解析标准 WebVTT（含 `<v Speaker>` 说话人标签）、SRT 以及 `[mm:ss] 文本` 简化时间戳格式，按起点排序并自动闭合开放区间；
   - [`sliceLoopRange`](../../src/plugins/stage-timeline/index.ts) 与 [`findCueAt`](../../src/plugins/stage-timeline/index.ts) 支持播放时的当前句高亮同步与 A-B 区间循环复听，并为 `dojo-shadowing` 提供原位句级锚点。

---

## 6. 验证命令

```bash
node --experimental-strip-types --test tests/core-epub-and-typography.test.ts tests/wave3-track1-reader-formats.test.ts tests/wave13-pagination-browser.test.ts
```
