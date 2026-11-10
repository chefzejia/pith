# 子系统 2：多模态呈现舞台（`Stage` · `stage-reader` & `stage-timeline`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [3-dojos.md](3-dojos.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 职责与边界：`Stage` 是承载任意材料的静默画布底板

对应人类认知训练管线的 **第 1 阶段：预训练（Pre-training · 一手语料与定制讲义摄入）**。

在 Pith 的插件架构中，**舞台（`Stage`）** 只解决一个纯粹的问题：**“如何把当前 Topic 的材料清晰、零干扰地呈现出来，并为每个内容片段赋予稳定的内在坐标（`IntrinsicLocator`）”**。
- `Stage` 不绑定特定的训练法则，也不需要 AI 去动态增删；系统根据当前打开的材料类型自动选择匹配的 `Stage`；
- 同时，`Stage` 通过标准 DOM 数据属性（`data-locator`、`data-prose`、`.pith-cue`）向挂载在当前课题上的 **脚手架工具（`Toolkit`）** 暴露原位 `UI Protocol` 叠加锚点。

---

## 2. 任意输入材料的三层渲染托底（Anything-as-Input on Stage）

Pith 的输入不局限于电子书，[`stage-reader`](../../src/plugins/stage-reader/index.ts) 与 [`stage-timeline`](../../src/plugins/stage-timeline/index.ts) 为各种形态的材料提供三层渲染托底：

1. **第一层：结构化出版物、定制讲义与多模态时间轴**
   - **向导递进讲义与 Markdown 文档（`.md / .markdown`）**：支持渲染向导为庞大课题拆解的《`00-课程大纲.md`》、《`01-xxx.md`》、内嵌教学块（````pith-teaching````）及源码引用锚点；
   - **重排与定版书籍（`.epub / .pdf / .cbz / 单图`）**：支持黄金版心多栏按屏分页；
   - **音视频与时间轴台词流（`.mp3 / .wav / .m4a / .mp4 / .webm` + `.vtt / .srt`）**：由 `stage-timeline` 渲染上方媒体区 + 下方同步台词流，联动底部 `.pith-media-deck`。
2. **第二层：任意纯文本与代码源文件（`.ts / .py / .rs / .go / .js / .json / .yaml / .txt / .sh / .abc` 等）**
   - 用户导入任意代码文件、配置文件、文本乐谱或日志时，`stage-reader` 将其按行/块渲染为带 `text:line:<N>` 内在坐标的可选中文本文档，支持直接框选任意代码行高亮、记笔记、问向导或挂载 `feynman` 工具复述。
3. **第三层：绑定本地 Git 代码仓库（`kind: "repo"`）或无初始文件课题**
   - 当 Topic 刚通过一句话意图创建或仅绑定了本地代码仓库（尚未生成第一篇讲义文件）时，Stage 呈现清晰的**课题引导空态（Empty Stage Prompt）**，展示当前绑定仓库/课题目标，并提供一键触发向导生成《`00-课程大纲.md`》的动作入口；一旦向导写入讲义，Stage 自动无缝切换并渲染该讲义。

---

## 3. 内在位置坐标系（`IntrinsicLocator`）与选区锚定

无论用户在宽屏桌面还是窄屏窗口打开同一份材料，也无论切换单栏、双栏还是调大字号，阅读进度与笔记锚点始终通过内在坐标恢复：

| 材料形态 | 坐标格式示例 | 解析与生成位置 |
| :--- | :--- | :--- |
| **Markdown 讲义 / 代码文本** | `text:line:42`（叠加句内偏移：`text:line:42;offset:18`） | [`stage-reader/index.ts`](../../src/plugins/stage-reader/index.ts) 中的 `markdownBlocks` |
| **EPUB 重排章节** | `epub:chapter:2;block:5`（章节号 + 块序号） | [`stage-reader/epub.ts`](../../src/plugins/stage-reader/epub.ts) 中的 `renderEpub` |
| **PDF / CBZ / 固定版 EPUB** | `page:12` | [`stage-reader/fixedPage.ts`](../../src/plugins/stage-reader/fixedPage.ts) 中的 `renderPdf` / `renderCbz` |
| **音视频字幕流** | `time:860`（秒级起点） | [`stage-timeline/index.ts`](../../src/plugins/stage-timeline/index.ts) 中的 `parseTranscript` |
| **代码仓库文件引用** | `repo:<commitSha>:<path>#L<start>-L<end>` | [`src/core/types.ts`](../../src/core/types.ts) 中的 `IntrinsicLocator` |

- **正文与非正文严格标记（`data-prose`）**：标题、普通段落、引文标记为 `data-prose="true"`；代码块、数学公式、表格、YAML Frontmatter、教学卡片以及 `interline` 工具嵌入的译文节点一律标记为 `data-prose="false"`。下游 TTS 伴读仅提取 `data-prose="true"` 的纯粹原文朗读。
- **内嵌教学块协议（[`extractTeachingBlocks`](../../src/plugins/stage-reader/teachingBlocks.ts)）**：识别讲义中的 ````pith-teaching```` 围栏块与 `> [!reflection|hint|checkpoint|explanation]` Callout，渲染为 `<section class="pith-teaching-block" data-teaching-kind="..." data-locator="text:line:<n>" data-prose="false">`，供向导在定制讲义中插入思考卡、提示与自测锚点而不被 TTS 误读。
- **文本重定位容错（[`matchTextAnchor`](../../src/plugins/stage-reader/textAnchor.ts)）**：优先按 `locator` 精确匹配，当文本前部发生插入/删除导致偏移漂移时，回退至 `quote + prefix + suffix` 上下文匹配度与最小距离评分重定位。

---

## 4. EPUB 净化与黄金版心多栏分页恒等式（`epub.ts` & `pagination.ts`）

1. **容量与安全边界（Fail-Closed）**：[`Zip`](../../src/plugins/stage-reader/epub.ts) 对单文件与整书解压字节数执行硬性上限检查；净化原书 HTML 时强制剥离任何以 `pith-` 开头的伪造类名及宿主保留 `data-*` 属性。
2. **多屏翻页步长恒等式**：
   - 电子书（`epub / pdf / cbz`）采用**零横向滚动条的按屏分页模式**（`overflow: hidden`）；
   - 列宽 `columnWidthPx`、列间距 `columnGapPx` 与水平内边距 `horizontalInsetPx` 恒满足：
     $$\text{columnGapPx} = 2 \times \text{horizontalInsetPx}$$
     $$\text{columns} \times (\text{columnWidthPx} + \text{columnGapPx}) \equiv \text{viewportWidth}$$
3. **跨列字符测量与缩放锚点保护**：通过 `range.getClientRects()` 过滤宽高非零的真实字符片段；窗口连续缩放触发 `ResizeObserver` 重排时直接恢复缩放前的锚点位置。

---

## 5. 时间轴媒体舞台与统一播放控制底座联动（`stage-timeline`）

1. **复合媒体视图结构（[`renderTimelineView`](../../src/plugins/stage-timeline/index.ts) · 零原生播放器冗余）**：
   - 当材料为音视频或附带 `.vtt / .srt` 字幕时：
     - 若为视频（`mediaKind === "video"`），上方仅渲染无原生控制条的纯净视频画面 `<video class="pith-timeline-video" playsinline src="...">`；若为纯音频（`mediaKind === "audio"`），**严禁在正文上方渲染冗余的 `<audio controls>` 原生播放器或 `"A-B 循环未设置"` 状态文字**；
     - 所有播放/暂停、进度条与语义切片刻度统一归口到底部唯一的 **统一播放控制底座（`.pith-media-deck`）**；
   - 下方呈现同步台词流（`.pith-cue[data-locator="time:<sec>"][data-end-sec="<end>"][data-prose="true"]`），每个 `.pith-cue` 携带精确的 `startSec` 与 `endSec`，点击任意台词或点击底部进度条上的语义切片刻度，即刻同步定位播放位置并聚焦对应台词。

---

## 6. 验证命令

```bash
node --experimental-strip-types --test tests/core-epub-and-typography.test.ts tests/wave3-track1-reader-formats.test.ts tests/wave13-pagination-browser.test.ts
```
