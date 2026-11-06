# Product Definition

> **We used all human wisdom to train AI. Pith uses AI's training pipeline to train you.**
> **全人类都在拿智慧训练大模型；Pith 借大模型的方法，训练你自己。**

## 产品定位与解决的核心问题

- **时代背景与核心痛点**：在 Super Agent 时代，外部产出的边际成本趋近于零，信息噪音与营销焦虑呈指数级爆炸，撕裂人类恒定且稀缺的生物注意力带宽。与此同时，系统的最终瓶颈正回到人类自己身上——如果人停止进化，整天只靠向 AI「许愿」来跳过思考，或满足于“看懂 AI 总结即掌握”的流畅性错觉，大脑的底层参数就从未更新，最终将丧失领导 AI 的判断力并沦为硅基智能的附庸。
- **核心范式（Human Training Pipeline）**：人类学习与大模型训练本质上是同一件事。Pith 将训练顶尖大模型的科学管线逆向工程为「理论 + 具身实践」的人类自我进化闭环：
  1. **算力调度与基座权重（`Compass` & `ME.md`）**：注意力是你唯一的算力。屏蔽信息流噪音，聚焦活跃课题（`Topic`）与 15 分钟微动作（`nextAction`），维护纯文本个人认知基座 `ME.md`；
  2. **预训练（`Pre-training` · 一手语料摄入）**：拒绝二手摘要阉割，通过多栏书卷舞台、时间轴舞台、行间双语伴读与神经语音听读降低精读一手原著/论文/源码的启动摩擦；
  3. **监督微调（`SFT` · 向导因人施教与工具编排）**：通过标准 ACP 协议接入本机 Agent，结合 `ME.md` 拆解难点、编写循序渐进的课程讲义，并按课题意图动态挂载认知工具（`topic.toolkits`）；
  4. **强化学习后训练（`Post-training RL` · 实训道场 `Dojo`）**：只读文本不更新人类参数。通过语音跟读（意群拆解 $\rightarrow$ 开口跟读 $\rightarrow$ 词级对齐）与概念重构（撤除原文 $\rightarrow$ 自我阐述 $\rightarrow$ 盲区诊断与向导追问）逼迫大脑前向生成（Rollout）并根据误差信号更新认知权重；
  5. **评测与权重合并（`Eval` · 结题沉淀）**：没有自己的思考与实训记录严禁结题（`pith_settle_topic`）；通过向导反例与迁移追问检验后沉淀归档并反哺更新 `ME.md`。
- **一句话定位**：以可观测原始材料（`Material`）为锚点、将大模型训练管线（Pre-train / SFT / RL / Eval）映射为人类认知内化闭环的个人注意力与自我训练系统。
- **明确不做什么（Non-goals & 红线）**：
  - ❌ 不做多聊天窗口（Session-based）的通用 AI 问答客户端；底层 AI 会话跑完即毁，用户只面对课题（`Topic`）与材料（`Material`）。
  - ❌ 不做一键替代原著阅读的自动摘要器；默认阅读表面永远以原始材料为信任锚点。
  - ❌ 不在用户设置面板暴露底层插件开关列表或 `preset: all/essentials` 选择器；工具由内核与向导按课题意图动态编排。
  - ❌ 不回退浏览器/系统自带机械语音（`speechSynthesis` / `webkitSpeechRecognition`），也不硬编码特定 Agent 的私有配置文件路径。

## 核心模块与交互总则（Directory-as-Product）

| 模块名称 | 代码目录映射 | 核心职责与用户闭环 |
| :--- | :--- | :--- |
| **注意力罗盘与账本** | [`src/core/engine/`](../src/core/engine/) & [`src/core/store/`](../src/core/store/) | 聚合活跃 `exploring` 课题与 15 分钟下一步微动作（`nextAction`），以纯文本 Markdown 唯一事实源串行落盘笔记与高亮 |
| **书卷阅读舞台** | [`src/plugins/stage-reader/`](../src/plugins/stage-reader/) | 渲染 EPUB / PDF / CBZ / Markdown，提供 `1 / 2 / 3` 栏黄金版心分页、章节独立断页、内部链接跳转与跨缩放位置保持 |
| **时间轴媒体舞台** | [`src/plugins/stage-timeline/`](../src/plugins/stage-timeline/) | 渲染音视频与 `.vtt/.srt` 字幕时间轴，联动底部停靠播客甲板（`.pith-media-deck`）同步高亮 |
| **行间双语伴读** | [`src/plugins/dojo-interline/`](../src/plugins/dojo-interline/) | 为外文原著提供 `原文 / 行间双语 / 译文主显` 舞台内嵌字幕，按滑动窗口（`activeUnit -> neighborhood`）静默预热并持久化至 `_cache/interline/` |
| **外语跟读与费曼实训** | [`src/plugins/dojo-shadowing/`](../src/plugins/dojo-shadowing/) & [`src/plugins/dojo-feynman/`](../src/plugins/dojo-feynman/) | 按 `意群拆解 -> 原文跟练 -> 骨干词挖空 -> 盲产诊断` 渐进撤除拐杖，诊断漏词与复述盲区 |
| **ACP 向导协同** | [`src/plugins/guide-acp/`](../src/plugins/guide-acp/) | 通过标准 ACP 协议接入本机 Agent，结合 `ME.md` 因人施教并按用户意图动态挂载 `topic.toolkits` |
| **外部/按需语音服务** | [`src/plugins/speech-service/`](../src/plugins/speech-service/) & [`src/shells/speechRuntime.ts`](../src/shells/speechRuntime.ts) | 通过 OpenAI 兼容 HTTP 协议对接云端或 Vault 外本机按需神经语音网关，空闲自动退出释放内存 |

### 空间与交互铁律（完整契约见 [subsystems/5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md)）

1. **44px 极简顶栏与意图驱动的一级工具槽**：
   - 顶栏右侧一级入口依次为：分页器 `< 1/N >`、已注入的实训工具胶囊（`🛠`）、伴读（`🎧`）、排版（`Aa`）、向导开关（`?` / `help-circle`）；Pith 主图标固定为植物幼苗 `sprout`。
   - `topic.toolkits: []` 默认不显示任何实训工具入口；仅当向导根据用户意图注入或课题已有保存工具时才在顶栏显示对应入口。多工具选择在顶栏入口完成，不在已打开的面板内嵌套第二个“工坊”切换器。
2. **工具多点位空间注入与底部唯一准入边界**：
   - 点击顶栏右上角 `[Aa]` 或工具胶囊时，轻量模式/阶段开关紧贴顶栏右下方（`top: 100%; right: 8px`）近源展开，**严禁从屏幕底部或左下角弹出**；而具体的训练动作（行间双语嵌入、跟读词对齐、复述遮罩与阐述）直接映射至 Stage 画布目标块与右侧向导栏，拒绝在浮窗内堆砌可编辑“目标文本”表单。
   - **内容正下方区域（Bottom Area）唯独只有音频播放控制条（`.pith-media-deck`）允许进入**（实心停靠挤压阅读容器高度，零遮挡正文）。
3. **书卷黄金版心与纯净分页**：
   - 书籍（`epub / pdf / cbz`）采用无横向滚动条的纯按屏分页（`overflow: hidden`，通过滚轮、方向键或顶栏按钮翻页）；每个 `.pith-epub-chapter + .pith-epub-chapter` 强制 `break-before: column` 独立起页。
   - 用户可在 `[Aa]` 中显式选择 `单栏 | 双栏 | 三栏`（默认单栏）。栏数上限仅由阅读容器实时宽度决定；超宽屏下单栏或多栏自动居中收敛于舒适列宽并保持多屏翻页步长恒等式 `columns * (columnWidthPx + columnGapPx) === viewportWidth`。
4. **纯净框选与伴读过滤**：
   - 框选非空正文时仅弹出 `[ 高亮 | 记笔记 | 问向导 | 复制 ]` 四项动作；
   - 开启 `行间双语` 时，嵌入的译文节点标记 `data-prose="false"`，TTS 伴读仅提取纯粹原文朗读，绝不混读译文。

## 领域概念与不变量（Domain & Glossary）

| 业务概念 | 代码/Schema 标识 | 定义与不变量约束 |
| :--- | :--- | :--- |
| **工作区** | `Workspace` | 纯文本根目录（Obsidian 壳默认位于 Vault 下 `Pith/`），严禁使用旧名 `Sylva / Garden` |
| **学习者画像** | `Profile` (`ME.md`) | 全工作区唯一，记录已知领域、类比偏好与认知盲区；课题沉淀时反哺更新 |
| **探索课题** | `Topic` (`topics/topic-<id>/topic.md`) | 注意力管理基本单元，含 `status: "exploring" \| "settled"`、`nextAction` 与按需挂载的 `toolkits` |
| **可观测材料** | `Material` (`materials/material-<id>/`) | 100% 只读的原始文件（`files/`）或向导生成的课程讲义，附带阅读进度 `locator` |
| **内在位置坐标** | `IntrinsicLocator` | 与屏幕尺寸、字号无关的稳定定位符（`text:section:<n>;block:<m>;offset:<k>`、`page:<n>`、`time:<s>`） |
| **思考与磕绊记录** | `Note` & `SelectionAnchor` | 锚定在具体材料坐标与原文引用（`quote`）上的高亮（`highlight`）、笔记（`note`）与实训记录（`practice`） |
| **向导与表层皮肤** | `Guide` & `SurfacePersona` | 内核固定使用中性词 `Guide`；界面层支持切换 `"sanctuary"`（花园/园丁）与 `"studio"`（工作区/向导） |
