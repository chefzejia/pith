# 子系统 3：阅读辅助与训练工具（`Toolkit` · `src/plugins/toolkit-*/`）

> 总纲：[ARCHITECTURE.md](../ARCHITECTURE.md) · 产品定义：[PRODUCT.md](../PRODUCT.md) · 平行子系统：[1-core-store-engine.md](1-core-store-engine.md) · [2-stages.md](2-stages.md) · [4-guide-speech-shells.md](4-guide-speech-shells.md) · [5-spatial-ui-and-slots.md](5-spatial-ui-and-slots.md)

---

## 1. 定位

舞台（`Stage`）解决材料怎么显示，工具（`Toolkit`）解决在这份材料上怎么降低理解阻力、怎么逼大脑和身体做主动训练。

**命名**：这个概念只有一个名字，`Toolkit`。插件目录是 `src/plugins/toolkit-<id>/`，插件 ID 是 `toolkit-<id>`，服务名是 `toolkit.<id>`，类型是 `ToolkitDescriptor`、`ToolkitStage`、`ToolkitDiagnosis`，DOM 类名与数据属性以 `pith-toolkit-`、`data-toolkit-` 开头。`dojo` 一词不出现在源码、测试文件名、界面文案和文档里；账本里的工具 ID 只有不带前缀的一种写法（`feynman`），不接受 `dojo-feynman` 或 `none`。

工具不另起界面，通过原位覆盖层寄生在舞台的目标块上（`.pith-cue` 或 `[data-prose="true"]`）。按产出归属分两类：

| 角色 | 挂在哪里 | 产出 | 谁能开关 | 内置 |
| :--- | :--- | :--- | :--- | :--- |
| **阅读辅助**（`aid`） | 材料（`material.aids`） | 只有可重建的缓存 | 用户，课题内外都可以 | `interline` |
| **训练工具**（`training`） | 课题（`topic.toolkits`） | 实训记录，归课题 | 用户在顶栏；向导经 `pith_configure_toolkits` | `shadowing`、`feynman` |

训练工具只在课题内可用：它们产生的实训记录需要一个课题来承接，也是结题门禁的依据。

---

## 2. 挂载规则

- **阅读辅助的初始值**：材料导入时，抽样文本里非汉字的字母字符占比达到 50%，`aids` 预置为 `["interline"]`；否则为空。这是唯一的启发式规则。
- **训练工具的初始值**：向导在 `pith_create_topic` 里按课题目标给出。没有按材料类型预挂载训练工具的规则。
- **之后的变更**：用户在顶栏工具菜单勾选或取消任意已注册的训练工具；向导了解到真实目标后调用 `pith_configure_toolkits` 重设列表。两者写的是同一个 `topic.toolkits`，顶栏与舞台原位控件即时更新。
- **设置面板不出现插件开关列表。**

工具描述符（[`ToolkitDescriptor`](../../src/core/seams.ts)）声明 `role: "aid" | "training"`、`whenToUse`（写给向导的适用场景）、`compatibleStages`、`uiProtocol` 与 `quickActions`。两个可选成员：

- `diagnose(target, produced)`：确定性对齐，只有 `shadowing` 提供。
- `followUp(result)`：把一条实训记录的 `result` 变成给向导的本回合指令，没有可追问的内容时返回空。工作台拿到指令后经 `runTurn` 的 `instruction` 交给向导；工具插件不导入向导插件。

`evalMode`、`evaluationRubric` 与写在消息正文里的 `PITH_PRACTICE:` 前缀不再存在。

---

## 3. 三个内置工具

### 3.1 `interline`（行间）· 阅读辅助

- **界面**：在每个 `[data-prose="true"]` 段落正下方插入 `.pith-interline-subtitle[data-prose="false"]`，一行原文一行译文。阅读控制里切换 `[ 原文 | 行间 | 译文主显 ]`。
- **状态**：`material.aids` 含 `interline` 时，这份材料打开即为「行间」；切到「原文」把它从 `aids` 移除。「译文主显」是当次阅读的显示状态，不落盘。
- **翻译**：经后台一次性请求（[4-guide-speech-shells.md](4-guide-speech-shells.md) 2.6）调用本机 Agent，按当前阅读位置的邻域优先（`activeUnit ± 1`）逐段翻译，译文缓存到 `_cache/interline/`，按材料存放，所以同一份材料在任何课题里都复用同一份译文。
- **Agent 不可用时**：只显示原文，并在阅读控制里说明原因。
- **伴读**：译文块是 `data-prose="false"`，TTS 跳过。

### 3.2 `shadowing`（影子跟读）· 训练工具

- **评价方式**：确定性的词级对齐，不经过模型。
- **界面**：聚光灯声学卡片，没有打字框。
  1. 顶部四阶滑块 `[ 韵律 | 原文 | 骨干 | 盲听 ]`；
  2. 中央大字号（21 到 22px）台词区：「韵律」显示呼吸斜杠，「骨干」是虚线槽位，「盲听」用 `filter: blur(6px)` 遮罩，录完直接在原句上标出漏词；
  3. 底部声学坞：左侧 `[ 原声 ]` 与 `[ 循环 ]`，中央 `[ 开口跟读 ]`，录完出现 `[ 回听对比 ]` 与 `[ 记入账本 ]`。
- **记录**：`practice`，`result` 为漏词与命中词。
- **向导配合**：经 `pith_search_media` 与 `pith_fetch_media_corpus` 搜索并拉取带时间轴字幕的音视频，推荐 20 到 30 秒的跟读桥段。

### 3.3 `feynman`（费曼复述）· 训练工具

反馈是对照，不是评价。没有分数、评级、覆盖比例、形容词和总评。

**流程**

1. **抽要点**（打开遮罩时开始，不等提交）。把目标段落发给模型，要求返回要点清单，每条带一段原文引用。程序逐条核对引用确实出现在该段落里（忽略空白差异），核对不过的条目丢弃。清单写入 `_cache/feynman/`，以段落内容的哈希为键；同一段落之后不再重新抽取。标准定在看到复述之前。
2. **复述**。目标段落原位折叠遮罩，下方展开纯文本框。
3. **对照**（提交后）。请求里只有三样东西：原文段落、要点清单、一段复述。不带画像、对话和课题信息，也不说明复述是谁写的。模型对每条要点返回一个状态和一段复述里的原话：

   | 状态 | 含义 | 要求 |
   | :--- | :--- | :--- |
   | `covered` | 复述说到了这条 | 给出复述里的原话 |
   | `missing` | 复述没提 | 无 |
   | `contradicted` | 复述的说法与原文相反 | 给出复述里的原话 |

   程序核对每段「复述里的原话」确实出现在复述中；核对不过的条目标为 `unverified`，界面显示「未能核对」。输出是结构化的，没有自由文本字段。
4. **展示**。逐条列出：状态、原文引用、你的原话。不汇总，不计数。
5. **追问**。`followUp` 选一个缺口：第一条 `contradicted`，没有则第一条 `missing`，并生成指令：只就这条要点问一个问题，不代答，不评价。没有缺口时，指令是出一道反例或迁移题。工作台以你的复述为消息、以这条指令为 `instruction` 发起一个课题回合。

**记录**：`practice`，正文是你的复述，`result` 是要点清单与逐条状态。漏掉的是哪几条因此留在账本里。

**降级**

- 抽要点失败，或核对后一条不剩：复述照常保存为没有 `result` 的实训记录，界面说明对照不可用及原因。
- 对照请求失败：同上，并可重试对照。

**边界**

- 上面的保证只覆盖对照这一步。追问之后你的回答走普通课题对话，那里的回应由向导的规则约束，不是程序保证。
- 验收必须用真实配置的 Agent 跑三类复述并留存输出及重复稳定性：说反一条的必须标为 `contradicted`；漏掉一个前提的必须标为 `missing`；换一套说法但意思正确的必须标为 `covered`。任一类不稳定，先改提示词，不改界面。

> **扩展**：新增音乐或代码实训时，在 `src/plugins/` 下新建插件，注册对应的舞台（如乐谱）与训练工具（如 WebMIDI 跟弹），向导即可在相应课题里挂载它。

---

## 4. 验证命令

```bash
npm run test:file -- tests/wave2-trackA-plugins.test.ts tests/wave5-trackA-toolkit-feynman.test.ts tests/toolkit-interline.test.ts
```
