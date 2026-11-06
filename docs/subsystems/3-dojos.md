# 子系统 3：正交认知工具与后训练实训道场（`dojo-*`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 职责与正交维度

`src/plugins/dojo-*` 下是由向导（Guide）根据课题（`Topic`）的真实意图、按需注入 `topic.toolkits` 的**三个正交认知维度**——它们可以单独挂载，也可以在同一课题中自由组合：

| 正交维度 | 代表插件 | 评价模式 (`evalMode`) | 介入训练阶段 | 物理动作与反馈机制 |
| :--- | :--- | :--- | :--- | :--- |
| **输入降噪脚手架**<br>*(Input Scaffolding)* | [`dojo-interline`](../../src/plugins/dojo-interline/) | - | **1. Pre-training**<br>*(一手语料摄入)* | 在不破坏原著版心的前提下，于段落正下方嵌入滑动预热的行间母语字幕，降低外文一手材料的启动阻力。 |
| **程序性/肌肉记忆跟练**<br>*(Procedural Drill)* | [`dojo-shadowing`](../../src/plugins/dojo-shadowing/) | `"deterministic"`<br>*(确定性词对齐)* | **3. Post-training RL**<br>*(声学/动作 1:1 复现)* | 针对语言跟读等程序性技能，追求与目标原句 1:1 精确复现，采用确定性词级对齐（LCS）在原位标出吞音与漏词。 |
| **生成式/心智模型内化**<br>*(Generative Recall)* | [`dojo-feynman`](../../src/plugins/dojo-feynman/) | `"guide-rubric"`<br>*(向导教练规程)* | **3. RL & 4. Eval**<br>*(概念重构与教练追问)* | 针对概念、机制与架构内化，撤除原文拐杖逼迫学习者用自己的话阐述因果链，交由向导按 `evaluationRubric`（三明治苏格拉底追问规程）检验盲区。 |

---

## 2. 程序性跟读与生成式复述的差异化脚手架（`DojoToolkitDescriptor`）

### 2.1 两种实训的不同脚手架形态

[`DojoToolkitDescriptor`](../../src/core/seams.ts) 不强迫所有实训工具生搬硬套同一个 UI 模板，而是按训练目标的本质提供恰当的原位变形（UI 原位挂载规范见 [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)）：

1. **`dojo-shadowing`（外语语音与语感跟读 · 四阶渐进镜头 `DojoScaffoldStage`）**：
   - 在时间轴舞台（`.pith-cue`）或目标段落原位提供 4 个渐进撤拐杖档位：
     - `1. listen-decompose`（意群拆解）：每隔意群边界（标点或词数阈值）插入 `/` 呼吸停顿标记；
     - `2. guided-follow`（原文跟练）：展示完整字幕，配合语音逐句跟读建立口腔肌肉记忆；
     - `3. scaffold-cloze`（骨干词）：挖空介词、冠词、助动词与连词等语法功能词为 `___`，检验语块衔接；
     - `4. blind-produce`（盲听诊断）：遮蔽全文为 `••••••••`，凭听觉或记忆开口跟读并由 ASR 转写对齐漏词。
2. **`dojo-feynman`（概念内化与复述 · 原位合书遮罩与直接阐述）**：
   - 概念内化无需机械切换“按句号拆行/双字挖空”四阶段按钮；触发费曼复述时，直接在 Stage 画布原位将目标段落平滑折叠/遮罩（`blind-produce` 合上原文态），在段落下方内联展开阐述框（支持打字与 `🎙️` 麦克风口述），一步直达主动生成与向导追问。

### 2.2 两种正交评价与反馈机制（`evalMode`）

1. **`evalMode: "deterministic"`（确定性序列对齐 · 用于 `dojo-shadowing`）**：
   - [`diagnose(targetText, producedText)`](../../src/plugins/dojo-shadowing/index.ts) 对目标文本与学习者产出（或麦克风 ASR 转写文本）做 NFC 归一化后执行动态规划最长公共子序列（LCS）词级对齐（矩阵规模受硬上限保护）；
   - 直接在原位标出漏读词（`missedTokens`），不渲染引发防御心理的考试总分，支持一键存为 `kind: "practice"` 笔记。
2. **`evalMode: "guide-rubric"`（向导语义教练规程 · 用于 `dojo-feynman`）**：
   - 概念内化与迁移严禁使用死板的正则表达式凑词打分；[`feynmanToolkit`](../../src/plugins/dojo-feynman/index.ts) 声明专属的 `evaluationRubric`（**三明治苏格拉底追问规程**）：
     - **🟢 已掌握主干**：肯定学习者复述中抓准的核心因果链或自创的恰当类比；
     - **🟡 遗漏的前提/边界**：指出对照原文漏掉的一个关键机制前提或极端边界条件（不直接替学习者背书）；
     - **🎯 深水区一问**：提出 1 个具体的反例或跨场景迁移问题，引导学习者补齐缺口。
   - 学习者提交复述后，系统将目标锚点 `anchor`、学习者复述正文与 `evaluationRubric` 注入向导上下文（[`buildScenePrompt`](../../src/plugins/guide-acp/index.ts)），在右侧向导栏展开追问并落盘 `practice` 笔记（仅当向导离线未配置时回退至本地关键词盲区提示）。

---

## 3. 行间双语伴读与滑动窗口预热（`dojo-interline`）

`dojo-interline` 让学习者直接阅读外文一手原著，同时在每个正文块下方按需嵌入母语对齐字幕：

1. **三种展示模式（`InterlineDisplayMode`）**：
   - `original`：仅显示原文；
   - `bilingual`：原文为主，段落正下方嵌入弱化样式的行间译文（`<span class="pith-interline-subtitle" data-prose="false">`）；
   - `subtitle-primary`：译文主显、原文对照。
   - **伴读隔离铁律**：所有嵌入的译文节点强制标记 `data-prose="false"`，确保开启 `🎧 听读` 时 TTS 只朗读纯粹外文原文，绝不混读母语译文。
2. **FNV-1a 64-bit 源文本哈希（[`computeSourceHash`](../../src/plugins/dojo-interline/index.ts)）**：
   - 对每个 `data-prose="true"` 段落归一化空白后计算 16 位十六进制哈希；缓存命中时校验 `sourceHash`，原文未变则直接零延迟复用 `_cache/interline/` 中的译文。
3. **邻域优先滑动窗口预热（[`InterlinePreparationCoordinator`](../../src/plugins/dojo-interline/coordinator.ts)）**：
   - [`planNeighborhoodOrder(activeUnit, totalUnits, radius)`](../../src/plugins/dojo-interline/index.ts) 按 **`[当前章节 activeUnit] → [邻近章节 activeUnit ± 1..radius] → [其余章节]`** 的优先级排序；
   - 当用户快速翻页或跨章跳转调用 [`activateUnit(newIndex)`](../../src/plugins/dojo-interline/coordinator.ts) 时，协调器**不粗暴中断已在途（in-flight）的翻译请求**（确保已消耗的 Token 正常落盘缓存），并在当前批次完成后的下一拍立即将新活动章节提权至队首。

---

## 4. 验证命令

```bash
node --experimental-strip-types --test tests/wave2-trackA-plugins.test.ts tests/wave5-trackA-dojo-feynman.test.ts tests/dojo-interline.test.ts
```
