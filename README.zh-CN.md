# Pith

> **/pɪθ/** — 植物髓心、脊椎中枢、事物的精髓。
>
> **全人类都在拿智慧训练大模型；Pith 借大模型的方法，训练你自己。**

[English](README.md) | **简体中文**

Pith 是一个宿主无关的**个人注意力防噪与人类认知训练系统（Personal Attention & Human Training System）**，可以运行在 [Obsidian](https://obsidian.md)、独立 Web 桌面端与 Super Agent 工作台（DSH）中。

---

## 为什么做 Pith：Super Agent 时代的「人类瓶颈」

在 AI 时代，外部内容生成的边际成本趋近于零，信息噪音与焦虑叙事呈指数级爆炸。越是身处 AI 一线的从业者与创造者，注意力越容易被多窗口、多项目与碎片信息撕裂——然而**人类的生物注意力带宽是恒定的**。

与此同时，当 Agent 能力迈向 Super Agent，**系统的最终瓶颈正回到人类自己身上**：你的品味、你的判断力、你定义问题的深度，以及你一眼看出 AI 逻辑漏洞的能力。

如果一个人停止自身进化，把所有问题都丢给 AI「许愿」，满足于看懂 AI 嚼碎的二手总结（流畅性错觉），那么他的大脑参数从头到尾都没有更新。一个不进化的人无法领导更强的 AI，最终只会沦为硅基智能的附庸。

**人类倾尽智慧结晶，摸索出了训练顶尖大模型的完整范式；Pith 将这套方法论逆向工程回来，用于训练人类自己。**

---

## 核心框架：把人类自己当成大模型来训练

没有经过你自己大脑「前向生成（Rollout）→ 暴露误差 → 反馈纠偏」的知识，永远不会写入你的底层直觉。Pith 将大模型训练的五个纵向阶段工程化为日常闭环，并由向导（Guide）按课题意图动态注入正交的认知工具（`topic.toolkits`）：

| 训练阶段 | AI 模型训练 | 人类认知进化（理论 + 具身实践） | Pith 里的协同机制（Core + Stage + Guide + 按需注入的 Toolkits） |
| :--- | :--- | :--- | :--- |
| **0. 算力调度与基座权重**<br>*(Compute & Base Weights)* | 集中有限算力预算；维护当前模型参数权重 | **注意力防噪与个人基座**：注意力是你唯一的算力。屏蔽信息流焦虑，聚焦极少数活跃课题与 15 分钟微动作 | **注意力罗盘（`AttentionEngine`）** + **`ME.md`（你的认知基座权重快照）** |
| **1. 预训练**<br>*(Pre-training)* | 清洗高质量一手语料，建立底座表征 | **一手原始材料摄入**：拒绝二手摘要阉割，直接精读原书、原论文、源码与长播客，在「可承受的困惑」中建立语感 | **阅读与时间轴舞台（`stage-reader` / `stage-timeline`）** + **Kokoro 神经语音伴读** + 按需注入的**输入脚手架（`dojo-interline` 行间双语）** |
| **2. 监督微调**<br>*(SFT)* | 高质量专家示范（Demonstration），对齐解题路径 | **因人施教的拆解与课程生成**：遇到超出当前认知的硬骨头或复杂代码仓，由熟知你背景（`ME.md`）的向导拆解因果链、编写精校讲义并编排课题工具 | **ACP 向导（`guide-acp`）**：标准协议接入本机 `dsh` / `claude` / `codex`，读取一手材料与 `ME.md` 生成讲义（`pith_write_lesson`）并动态挂载 `topic.toolkits` |
| **3. 强化学习后训练**<br>*(Post-training / RL)* | 模型必须自己先 Rollout 生成 → 环境给出客观误差信号 → 更新梯度 | **渐进撤拐杖的具身与认知实训**：只看懂文字不改变大脑参数。必须开口跟读或合上书阐述，拿自己的产出对撞反馈纠偏 | **按课题意图正交注入的产出实训道场（`Dojo`）**：<br>• **程序性复现（`dojo-shadowing`）**：意群拆解 → 开口跟读 → 漏词对齐；<br>• **生成式内化（`dojo-feynman`）**：撤除原文 → 自我阐述 → 盲区诊断与教练追问 |
| **4. 评测与权重合并**<br>*(Eval & Checkpoint Merge)* | 跑 Benchmark 验证泛化与迁移能力，合并权重落盘 | **结题大考与认知沉淀**：合上原文向向导讲清楚，抗住反例与跨场景迁移追问；没有自己的实训与思考记录，系统拒绝结题 | **硬性结题门禁（`pith_settle_topic`）** → 验证通过后沉淀归档并反哺更新 `ME.md` |

### 为什么 `dojo-*` 工具由向导按课题动态注入且彼此正交？

Pith 拒绝在界面上堆满所有功能的固定按钮。向导根据你开启课题（`Topic`）的真实意图，从三个正交维度将工具组合注入 `topic.toolkits`：
- **维度 A · 输入降噪脚手架（`dojo-interline`）**：服务于第 1 阶段（Pre-training），为外文原著嵌入滑动预热的行间双语字幕，降低一手材料启动阻力；
- **维度 B · 程序性/肌肉记忆跟练（`dojo-shadowing`）**：服务于第 3 阶段（RL），针对语音语调追求 1:1 精确复现，采用确定性词级对齐（LCS）标出漏词；
- **维度 C · 生成式/心智模型内化（`dojo-feynman`）**：服务于第 3 & 4 阶段（RL & Eval），针对概念与机制理解，撤除原文拐杖逼迫你用自己的话重构因果链，并配合向导的教练追问（Coach Rubric）检验迁移能力。

---

## 三个典型场景

### 1. 等 Agent 跑任务的 15 分钟间隙
Claude Code、Codex 或 DSH 正在后台跑编译和测试。这段等待时间如果拿去刷社交媒体，换来的只有焦虑和注意力碎片；打开 Pith，罗盘（Compass）直接给出你当前探索课题（`Topic`）的下一个 15 分钟微动作（`nextAction`），给自己的大脑做一次增量训练。

### 2. 啃透一本外文硬书或一手论文（Pre-training + SFT）
把 EPUB / PDF / 播客丢进工作区。默认呈现零干扰的 `1 / 2 / 3` 栏黄金版心分页；卡在长难句时开启**行间双语**（滑动窗口静默预热）或 **Kokoro 篇幅级神经语音伴读**降低启动摩擦；框选困惑处一键「问向导」，让本机 Agent 结合你的 `ME.md` 拆解背景。

### 3. 从「看懂了」到「合上书能讲出来」的后训练（Post-training RL → Eval）
大模型的动作空间止于文本，而人类的掌握需要声带、手指与思维的真实前向生成。向导根据你的课题意图，在顶栏动态注入 **费曼复述（Feynman）** 或 **影子跟读（Shadowing）** 实训道场：
1. **结构拆解（`listen-decompose`）**：切分意群或核心因果链；
2. **同步跟练（`guided-follow`）**：带稿领读或对照模仿；
3. **骨架挖空（`scaffold-cloze`）**：隐去核心概念词与语块，逼大脑主动提取；
4. **脱稿盲产（`blind-produce`）**：合上原文盲讲或跟读，自动对齐诊断遗漏概念与发音盲区，生成诊断账本落盘。

---

## 为什么是这套架构：纯文本权重 + 宿主无关

1. **纯文本即权重资产（Markdown-as-Weights）**
   你所有的认知资产——个人认知基座 [`ME.md`](src/core/types.ts)、探索课题 `topics/topic-<id>/topic.md`、只读一手材料 `materials/material-<id>/`——100% 是本地纯文本 Markdown。没有私有云数据库锁死，随时可 diff、可迁移、可被任何 Agent 直接读取；`_cache/` 仅存衍生缓存，删掉随时重建。
2. **三层单向零泄漏架构（Concentric 3-Layer DAG）**
   由 [`tests/boundaries.test.ts`](tests/boundaries.test.ts) 在每次测试时静态锁死：
   - **领域内核（[`src/core/`](src/core/)）**：`PluginRuntime`、`WorkspaceStore`、`AttentionEngine` 与 [`HostPort`](src/core/host.ts)，零宿主依赖、零 UI 框架依赖。
   - **平级内置插件（[`src/plugins/`](src/plugins/)）**：阅读舞台（`stage-reader`、`stage-timeline`）、四阶实训道场（`dojo-interline`、`dojo-shadowing`、`dojo-feynman`）、标准 ACP 向导（`guide-acp`）与语音底座（`speech-service`），插件间绝不互相导入，仅通过 [`seams.ts`](src/core/seams.ts) 通信。
   - **多态原生宿主壳（[`src/shells/`](src/shells/)）**：同一套内核与个人数据，无缝运行在 **Obsidian 插件壳**（`obsidian`）、**独立 Web 桌面壳**（`web`）与 **DeepSeek Harness 壳**（`dsh`）之上。
3. **原生标准协议，拒绝玩具级妥协**
   - **标准 ACP 向导发现**：通过 JSON-RPC stdio 标准协议连接本机 Agent，动态协商模型与推理强度，绝不硬编码特定 Agent 的私有配置文件。
   - **零 Python 依赖的按需神经语音网关**：本机语音采用原生 `sherpa-onnx` + `Kokoro-82M v1.1-zh`（TTS）与 `SenseVoice`（ASR），安装在 Vault 外并在空闲 180 秒后自动退出释放内存，绝不回退系统机械语音（`speechSynthesis`）。

---

## 快速开始

```bash
npm install
npm run web                # 启动独立 Web 桌面壳 (默认 http://127.0.0.1:4173)
npm run build:obsidian     # 打包 dist/obsidian/ 并自动同步至 .dev-vault/.obsidian/plugins/pith/
```

## 常用验证命令

| 命令 | 用途 |
| :--- | :--- |
| `npm run typecheck` | TypeScript 全仓静态类型检查 |
| `npm test` | 运行全仓单元测试与架构边界守卫（[`tests/boundaries.test.ts`](tests/boundaries.test.ts)） |
| `npm run build:obsidian` | 构建 Obsidian 插件产物并同步至 `.dev-vault` 沙盒 |
| `npm run verify:obsidian` | 拉起隔离的真实 `/Applications/Obsidian.app`（`.dev-vault`）执行 CDP 端到端真机验证 |
| `npm run web` | 启动独立 Web 宿主壳 |

## 文档地图

- [`docs/PRODUCT.md`](docs/PRODUCT.md)：产品哲学（人类训练管线）、核心模块、空间交互铁律与领域词表。
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 与 [`docs/subsystems/`](docs/subsystems/1-core-store-engine.md)：三层单向依赖、四大垂直子系统契约（[`1-core`](docs/subsystems/1-core-store-engine.md) · [`2-stages`](docs/subsystems/2-stages.md) · [`3-dojos`](docs/subsystems/3-dojos.md) · [`4-guide-speech-shells`](docs/subsystems/4-guide-speech-shells.md)）、数据所有权与关键架构决策。
- [`AGENTS.md`](AGENTS.md)：Agent 协作边界、验证命令与按需路由。
