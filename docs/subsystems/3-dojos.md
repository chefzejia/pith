# 子系统 3：学习脚手架工具与原位 UI 协议（`Toolkit` · `src/plugins/dojo-*/`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 核心定位：什么是 `Toolkit`？它与 `Stage` 如何协同？

在 Pith 中（代码中历史标识符 `Dojo` / `dojo-*` 统一指代 **`Toolkit` 脚手架工具**），如果说 **`Stage`（舞台）** 解决了“材料怎么显示”，那么 **`Toolkit`（工具）** 就解决了**“在这份材料上怎么降低理解阻力、怎么逼大脑和身体做主動训练”**。

诸如“影子跟读（`shadowing`）”这样既需要特定界面交互、又需要诊断逻辑的功能，通过 **「`Toolkit`（逻辑与 AI 编排契约） + `UI Protocol`（寄生于 Stage 之上的原位覆盖层）」** 彻底解耦：
1. **底层仍然是通用 `Stage`**：例如 `stage-timeline` 负责渲染字幕与控制音频，`stage-reader` 负责渲染书籍与讲义段落；
2. **`Toolkit` 声明前后端双重协议**：
   - **对后端（向导 Agent）**：声明 `whenToUse`（何时应该为用户的 Topic 挂载或移除该工具）、`orchestrationGuide`（挂载后 Agent 如何配合准备讲义或诊断误差）以及 `quickActions`（向导侧栏快捷胶囊）；
   - **对前端（Workbench 画布）**：通过 `UI Protocol` 声明如何在兼容的 `Stage` 目标块（`.pith-cue` 或 `[data-prose="true"]`）原位叠加交互控件（如行间译文层、跟读四阶同步与录音对比栏、费曼合书遮罩阐述栏）。

---

## 2. 工具生命周期：启发式默认挂载 + 向导/用户动态 CRUD

Pith 严格遵循**“Agent 介入前有聪明默认，Agent 介入后可完全灵活 CRUD”**的双拍机制：

### 2.1 第一拍：显式材料导入时的启发式默认挂载（`defaultToolkitsForMaterial`）

当用户直接上传或导入显式资料（尚未与向导 Agent 对话）时，系统根据材料特征自动为新建课题预挂载最匹配的初始 `topic.toolkits`：

| 用户上传/绑定的显式材料类型 | 启发式判定条件 | 默认自动挂载的 `toolkits` | 用户进入 Stage 即可获得的体验 |
| :--- | :--- | :--- | :--- |
| **外文书籍 / 外文论文 / 外刊文章** | `kind === "book" \| "article"` 且抽样文本中非中文（拉丁/日韩/西里尔等）字符占比显著 | `["interline", "feynman"]` | 顶栏直接出现 `[行间双语 · 2 ▾]`，一键开启段落下方母语对齐字幕，或点击段落进行费曼复述 |
| **带字幕或音视频的语料 / 播客** | `kind === "media"` 或包含音频/视频文件及 `.vtt / .srt` 字幕 | `["shadowing"]` | 顶栏直接出现 `[影子跟读]`，点击任意字幕句即可单句慢放、单句循环、录音跟读与回放对比 |
| **中文深度书籍 / 论文 / 绑定代码仓** | 中文 `book / article` 或 `kind === "repo"` | `["feynman"]` | 顶栏直接出现 `[费曼复述]`，阅读完核心章节或源码讲义后点击段落即可合书盲产并请向导追问 |

### 2.2 第二拍：向导 Agent 与用户的全灵活 CRUD（`pith_configure_toolkits` & 顶栏工具管理）

- **向导 Agent 自动识别与 CRUD**：
  - 向导的 System Prompt 中自动注入全量已注册 `Toolkit` 的说明清单（含 ID、适用场景与作用）；
  - 当向导通过对话了解到用户的真实目标（例如：*“我拿这篇英文演讲稿是为了下周上台脱稿演讲”* $\rightarrow$ 自动追加 `["shadowing", "feynman"]`；或者 *“我只想安静通读原文，不需要双语和跟读”* $\rightarrow$ 自动更新为 `[]`），直接通过 `pith_configure_toolkits`（或 `pith-toolkits` 围栏）增删改当前 Topic 的工具列表，前端顶栏与 Stage 原位控件实时热更新。
- **用户前端手动 CRUD**：
  - 用户点击阅读器顶栏右侧的 `🛠` 按钮时，近源展开的面板不仅能切换当前已挂载的工具，还可以直接勾选/取消勾选工作区已注册的任意 `Toolkit`（持久化回写 `topic.toolkits`），离线无 Agent 时依然 100% 掌控所有工具。

---

## 3. 内置三大正交 `Toolkit` 的前后端契约

| 工具 ID | 介入阶段 | 评价模式 (`evalMode`) | 后端向导编排职责 | 前端 `UI Protocol` 原位交互能力 |
| :--- | :--- | :--- | :--- | :--- |
| **`interline`**<br>*(行间双语)* | **1. Pre-train**<br>*(输入降噪)* | - | 使用本机 ACP Agent 按邻域优先级（`activeUnit ± 1`）将外文段落流式翻译为母语并缓存至 `_cache/interline/` | 在每个 `[data-prose="true"]` 段落正下方内嵌 `.pith-interline-subtitle[data-prose="false"]`；支持 `[ 原文 \| 行间双语 \| 译文主显 ]` 三档切换，且 TTS 伴读严格跳过译文 |
| **`shadowing`**<br>*(影子跟读)* | **3. RL**<br>*(程序性声学跟练)* | `"deterministic"`<br>*(确定性词对齐)* | 通过 `pith_search_media` / `pith_fetch_media_corpus`（内嵌 `yt-dlp`）主动为用户搜索并拉取带双语/原声时间轴字幕的音视频语料；推荐 20~30s 高价值跟读桥段；分析连读与弱读 | **聚光灯声学卡片（零打字框 `textarea`）**：1) 顶部极简四阶分段滑块 `[ 韵律 \| 原文 \| 骨干 \| 盲听 ]`；2) **中央大字号（`21~22px`）聚光灯台词区**（`韵律` 显示陶土色 `/` 呼吸斜杠，`骨干` 虚线槽位，`盲听` 采用 `filter: blur(6px)` 柔和毛玻璃遮罩，录完直接在原句大字上对漏词染色标亮）；3) **底部极简声学坞**：左侧 `[ 原声 ]` + `[ 循环 ]`，中央主胶囊 `[ 开口跟读 ]`（带录音律动动效），右侧录完浮现 `[ 回听对比 ]` 与 `[ 记入账本 ]` |
| **`feynman`**<br>*(费曼复述)* | **3. RL & 4. Eval**<br>*(心智模型内化)* | `"guide-rubric"`<br>*(苏格拉底追问规程)* | 按 `evaluationRubric` 执行**三明治苏格拉底追问**（🟢 肯定主干因果链 → 🟡 指出遗漏前提/边界 → 🎯 抛出 1 个反例或迁移问题） | 在目标段落原位将其平滑折叠遮罩（`【合上原文】`），紧贴下方展开纯文本阐述框（无冗余语音输入按钮，麦克风仅归属 `shadowing` 声学跟读），一键提交复述并联动右侧向导展开追问 |

> **面向未来的扩展性（如 `music-midi` / `code-sandbox`）**：未来新增音乐或代码实训时，只需在 `src/plugins/` 下新建插件并注册对应的 `Stage`（如 ABC/MusicXML 乐谱舞台）与 `Toolkit`（如 WebMIDI 跟弹对齐工具），向导即可在音乐 Topic 中自动识别并注入该工具。

---

## 4. 验证命令

```bash
node --experimental-strip-types --test tests/wave2-trackA-plugins.test.ts tests/wave5-trackA-dojo-feynman.test.ts tests/dojo-interline.test.ts
```
