# Product Definition

> **We used all human wisdom to train AI. Pith uses AI's training pipeline to train you.**
> **全人类都在拿智慧训练大模型；Pith 借大模型的方法，训练你自己。**

## 产品定位与解决的核心问题

- **时代背景与核心痛点**：在 Super Agent 时代，外部产出的边际成本趋近于零，信息噪音与营销焦虑呈指数级爆炸，撕裂人类恒定且稀缺的生物注意力带宽。与此同时，系统的最终瓶颈正回到人类自己身上——如果人停止进化，整天只靠向 AI「许愿」来跳过思考，或满足于“看懂 AI 总结即掌握”的流畅性错觉，大脑的底层参数就从未更新，最终将丧失领导 AI 的判断力并沦为硅基智能的附庸。
- **核心范式（Human Training Pipeline）**：人类学习与大模型训练本质上是同一件事。Pith 将训练顶尖大模型的科学管线逆向工程为「理论 + 具身实践」的人类自我进化闭环：
  1. **算力调度与基座权重（`Topic Board` & `ME.md`）**：注意力是你唯一的算力。屏蔽信息流噪音，在课题看板聚焦活跃课题（`Topic`）与今日焦点 15 分钟微动作（`nextAction`），维护纯文本个人认知基座 `ME.md`；
  2. **预训练（`Pre-training` · 一手语料摄入）**：拒绝二手摘要阉割，通过阅读与媒体舞台、输入降噪脚手架与神经语音听读降低精读一手原著、论文、源码与播客的启动摩擦；
  3. **监督微调（`SFT` · 向导因人施教与工具编排）**：通过标准 ACP 协议接入本机 Agent，结合 `ME.md` 拆解难点、编写循序渐进的课程讲义，并按课题意图动态挂载认知工具（`topic.toolkits`）；
  4. **强化学习后训练（`Post-training RL` · 舞台原位实训 `Dojo`）**：只读文本不更新人类参数。通过舞台原位的程序性跟练与生成式复述，逼迫大脑前向生成（Rollout）并根据误差信号更新认知权重；
  5. **评测与权重合并（`Eval` · 结题沉淀）**：没有自己的思考与实训记录严禁结题（`pith_settle_topic`）；通过向导反例与迁移追问检验后沉淀归档并反哺更新 `ME.md`。
- **一句话定位**：以可观测原始材料（`Material`）为锚点、将大模型训练管线（Pre-train / SFT / RL / Eval）映射为人类认知内化闭环的个人注意力与自我训练系统。
- **明确不做什么（Non-goals & 红线）**：
  - ❌ 不做多聊天窗口（Session-based）的通用 AI 问答客户端；底层 AI 会话跑完即毁，用户只面对课题（`Topic`）与材料（`Material`）。
  - ❌ 不做一键替代原著阅读的自动摘要器；默认阅读表面永远以原始材料为信任锚点。
  - ❌ 不在用户设置面板暴露底层插件开关列表或预设选择器；工具由内核与向导按课题意图动态编排。
  - ❌ 不回退浏览器/系统自带机械语音，也不硬编码特定 Agent 的私有配置文件路径。

## 核心架构槽位与交互总则（Directory-as-Product）

| 架构槽位 | 代码目录映射 | 核心职责与用户闭环 |
| :--- | :--- | :--- |
| **课题看板与工作区账本** | [`src/core/engine/`](../src/core/engine/) & [`src/core/store/`](../src/core/store/) | 聚合活跃 `exploring` 课题、已沉淀 `settled` 课题与今日焦点 15 分钟微动作（`nextAction`），以纯文本 Markdown 唯一事实源串行落盘笔记与高亮 |
| **预训练阅读与媒体舞台** | [`src/plugins/stage-reader/`](../src/plugins/stage-reader/) & [`src/plugins/stage-timeline/`](../src/plugins/stage-timeline/) | 渲染书籍、文档与音视频字幕流，提供黄金版心按屏分页、跨缩放内在位置锚定（`IntrinsicLocator`）与底部播客甲板联动（详见 [2-stages.md](subsystems/2-stages.md)） |
| **正交认知工具与实训道场** | `src/plugins/dojo-*/` | 由向导按课题意图注入 `topic.toolkits`，覆盖输入降噪脚手架、程序性对齐跟练与生成式复述三类正交维度，直接映射至舞台目标块原位（详见 [3-dojos.md](subsystems/3-dojos.md)） |
| **标准向导与按需语音服务** | [`src/plugins/guide-acp/`](../src/plugins/guide-acp/) & [`src/plugins/speech-service/`](../src/plugins/speech-service/) | 标准 ACP 协议向导协同（因人施教、生成讲义、编排工具、结题门禁）与 OpenAI 兼容神经语音伴读/转写（详见 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md)） |
| **全平台统一图形工作台** | `src/workbench/` & [`src/shells/`](../src/shells/) | 全 Shell（Obsidian / Web / DSH）共享唯一一份五区图形界面与交互状态机（详见 [5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md)） |

### 空间与交互铁律（完整契约见 [subsystems/5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md)）

1. **极简顶栏与意图驱动的一级工具槽**：
   - 顶栏右侧仅保留分页器、当前课题已挂载的实训工具胶囊、伴读、排版与向导开关；
   - `topic.toolkits: []` 默认不显示任何实训工具入口；仅当向导根据用户意图注入或课题已保存工具时才在顶栏显示对应入口。
2. **工具舞台原位映射与底部唯一准入边界**：
   - 顶栏右上角菜单仅作轻量模式或工具切换（近源展开），具体的实训动作（双语字幕、跟读四阶镜头、复述遮罩与内联阐述）100% 原位映射到 Stage 画布的目标段落/字幕句上，拒绝弹出独立大文本框表单浮窗；
   - **内容正下方区域（Bottom Area）唯独只有音频播放控制条允许进入**（实心停靠挤压阅读容器高度，零遮挡正文）。
3. **书卷黄金版心与纯净分页**：
   - 书籍采用无横向滚动条的按屏分页，每章独立起页；支持根据容器净宽切换单栏、双栏或三栏，超宽屏下自动居中收敛于舒适行宽。
4. **纯净框选与伴读过滤**：
   - 框选非空正文时仅弹出 `[ 高亮 | 记笔记 | 问向导 | 复制 ]` 四项动作；
   - 非正文块与嵌入译文节点严格隔离，TTS 伴读仅提取纯粹原文朗读，绝不混读译文或代码块。

## 领域概念与不变量（Domain & Glossary）

| 业务概念 | 代码/Schema 标识 | 定义与不变量约束 |
| :--- | :--- | :--- |
| **工作区** | `Workspace` | 纯文本根目录（Obsidian 壳默认位于 Vault 下 `Pith/`），严禁使用废弃历史名称 |
| **学习者画像** | `Profile` (`ME.md`) | 全工作区唯一，记录已知领域、类比偏好与认知盲区；课题沉淀时反哺更新 |
| **探索课题** | `Topic` (`topics/topic-<id>/topic.md`) | 注意力管理基本单元，含 `status: "exploring" \| "settled"`、`nextAction` 与按需挂载的 `toolkits` |
| **可观测材料** | `Material` (`materials/material-<id>/`) | 100% 只读的原始文件（`files/`）或向导生成的课程讲义，附带阅读进度 `locator` |
| **内在位置坐标** | `IntrinsicLocator` | 与屏幕尺寸、字号无关的稳定定位符（文本块偏移、页码、媒体秒数或代码行区间） |
| **思考与实训记录** | `Note` & `SelectionAnchor` | 锚定在具体材料坐标与原文引用（`quote`）上的高亮（`highlight`）、笔记（`note`）与实训记录（`practice`） |
| **向导与表层皮肤** | `Guide` & `SurfacePersona` | 内核固定使用中性词 `Guide`；界面层通过 [`DEFAULT_PERSONAS`](../src/core/types.ts) 解耦皮肤文案 |
