# 子系统 3：正交认知工具与后训练实训道场（`dojo-*`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md)

---

## 1. 职责与正交维度

`src/plugins/dojo-*` 下是由向导（Guide）根据课题（`Topic`）的真实意图、按需注入 `topic.toolkits` 的**三个正交认知维度**——它们可以单独挂载，也可以在同一课题中自由组合：

| 正交维度 | 代表插件 | 介入训练阶段 | 物理动作与反馈机制 |
| :--- | :--- | :--- | :--- |
| **输入降噪脚手架**<br>*(Input Scaffolding)* | [`dojo-interline`](../../src/plugins/dojo-interline/) | **1. Pre-training**<br>*(一手语料摄入)* | 在不破坏原著版心的前提下，于段落正下方嵌入滑动预热的行间母语字幕，降低外文一手材料的启动阻力。 |
| **程序性/肌肉记忆跟练**<br>*(Procedural Drill)* | [`dojo-shadowing`](../../src/plugins/dojo-shadowing/) | **3. Post-training RL**<br>*(声学/动作 1:1 复现)* | 针对语言跟读等程序性技能，追求与目标原句 1:1 精确复现，采用确定性词级对齐（LCS）标出吞音与漏词。 |
| **生成式/心智模型内化**<br>*(Generative Recall)* | [`dojo-feynman`](../../src/plugins/dojo-feynman/) | **3. RL & 4. Eval**<br>*(概念重构与教练追问)* | 针对概念、机制与架构内化，撤除原文拐杖逼迫学习者用自己的话阐述因果链，配合向导教练规程（Coach Rubric）检验盲区。 |

```text
src/plugins/
├── dojo-interline/           # 维度 A：行间双语输入脚手架（提供服务 "dojo.interline"）
│   ├── index.ts              # FNV-1a 段落哈希、邻域调度顺序与双语 HTML 嵌入（renderInterlineHtml）
│   └── coordinator.ts        # InterlinePreparationCoordinator（滑动窗口异步预热与 _cache/interline/ 持久化）
├── dojo-shadowing/           # 维度 B：程序性影子跟读道场（提供服务 "dojo.shadowing"）
│   └── index.ts              # 意群斜杠切分、功能词挖空与 LCS 词级对齐漏词诊断（diagnose）
└── dojo-feynman/             # 维度 C：生成式费曼复述道场（提供服务 "dojo.feynman"）
    └── index.ts              # 四阶提示词变换（transformCue）、概念盲区检测与向导深水区追问动作
```

---

## 2. 四阶渐进脚手架通用协议（`DojoToolkitDescriptor`）

所有实训类道场均实现 [`DojoToolkitDescriptor`](../../src/core/seams.ts) 接口，共享相同的四阶撤拐杖状态机（`DojoScaffoldStage`）：

| 阶段标识 | 认知训练目标 | `dojo-feynman`（概念内化与复述） | `dojo-shadowing`（外语语音与语感跟读） |
| :--- | :--- | :--- | :--- |
| **1. `listen-decompose`** | 有稿感知与结构拆解 | 按句切分编号，理清原文论证的先后因果链 | 每隔意群边界（标点或 ~10 词）插入 `/` 呼吸停顿标记 |
| **2. `guided-follow`** | 带稿同步跟练 | 展示完整原文，对照原文理顺解释逻辑 | 展示完整字幕，配合语音逐句跟读建立口腔肌肉记忆 |
| **3. `scaffold-cloze`** | 半脱稿骨架提取 | 挖空英文长实词（$\ge 5$ 字母）、反引号术语与中文核心双字概念词为 `[___]` | 挖空介词、冠词、助动词与连词等语法功能词为 `___`，检验语块衔接 |
| **4. `blind-produce`** | 脱稿盲产与误差诊断 | 隐藏原文，要求向初学者脱稿解释核心机制与边界条件 | 遮蔽全文为 `••••••••`，凭听觉或记忆盲读并由 ASR 转写 |

### 客观误差对齐（`diagnose(targetText, producedText)`）

- **费曼概念覆盖诊断（[`diagnoseFeynman`](../../src/plugins/dojo-feynman/index.ts)）**：从目标段落提取去停用词后的中英文核心概念集合（[`conceptTokens`](../../src/plugins/dojo-feynman/index.ts)），逐一比对学习者复述文本，输出概念覆盖率（`accuracyScore`）、已覆盖概念与遗漏盲区列表（`missedTokens`），一键存为 `kind: "practice"` 笔记。
- **跟读 LCS 词级对齐（[`diagnose`](../../src/plugins/dojo-shadowing/index.ts)）**：对目标文本与学习者产出（或 ASR 转写文本）做 NFC 归一化后执行动态规划最长公共子序列（LCS）对齐，精确标出漏读词与准确率（矩阵规模上限 `2,000,000` 单元，超限直接拒绝以防内存阻塞）。

---

## 3. 行间双语伴读与滑动窗口预热（`dojo-interline`）

`dojo-interline` 让学习者直接阅读外文一手原著，同时在每个正文块下方按需嵌入母语对齐字幕：

1. **三种展示模式（`InterlineDisplayMode`）**：
   - `original`：仅显示原文；
   - `bilingual`：原文为主，段落正下方嵌入弱化样式的行间译文（`<span class="pith-interline-subtitle" data-prose="false">`）；
   - `subtitle-primary`：译文主显、原文对照。
   - **伴读隔离铁律**：所有嵌入的译文节点强制标记 `data-prose="false"`，确保开启 `🎧 听读` 时 TTS 只朗读纯粹外文原文，绝不混读中文译文。
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
