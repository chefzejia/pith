# Product Definition

> **We used all human wisdom to train AI. Pith uses AI's training pipeline to train you.**
> **全人类都在拿智慧训练大模型；Pith 借大模型的方法，训练你自己。**

## 产品定位与解决的核心问题

- **时代背景与核心痛点**：在 Super Agent 时代，外部产出的边际成本趋近于零，信息噪音与营销焦虑呈指数级爆炸，撕裂人类恒定且稀缺的生物注意力带宽。与此同时，系统的最终瓶颈正回到人类自己身上——如果人停止进化，整天只靠向 AI「许愿」来跳过思考，或满足于“看懂 AI 总结即掌握”的流畅性错觉，大脑的底层参数就从未更新，最终将丧失领导 AI 的判断力并沦为硅基智能的附庸。
- **核心范式（Human Training Pipeline · 万物皆可投喂 + 认知管家拆课 + 脚手架实训）**：
  Pith 的输入绝不仅限于“阅读一本静态电子书”，而是**任何值得投入注意力的认知对象**（一句话庞大课题意图、本地 Git 代码仓库如 `DSH / magpie`、外文原著、论文、播客音视频或乐谱）。Pith 将训练顶尖大模型的科学管线逆向工程为「理论 + 具身实践」的人类自我进化闭环：
  1. **算力调度与统一立项台（`Topic Board` & `Unified Intake` & `ME.md`）**：注意力是你唯一的算力。屏蔽信息流噪音，在课题看板聚焦活跃课题（`Topic`）与今日焦点 15 分钟微动作（`nextAction`），维护纯文本个人认知基座 `ME.md`；通过首页中央唯一的**统一立项/投喂入口**，支持拖入任意显式文件（零延迟带默认工具直达 Stage）或输入庞大课题/绑定代码仓（一键交由向导管家立项拆课）；
  2. **预训练（`Pre-training` · 一手语料与多模态舞台 `Stage`）**：拒绝二手摘要阉割，通过文档、代码、时间轴媒体等舞台（`Stage`）与输入降噪工具（`interline` 行间双语）及神经语音听读，降低摄入一手原著、论文、源码与播客的启动摩擦；
  3. **监督微调（`SFT` · 认知管家课程拆解与工具动态 CRUD `Guide`）**：通过标准 ACP 协议接入本机 Agent 作为私人课程架构师，结合 `ME.md` 将庞大的陌生课题或代码仓库由浅入深拆解为《`00-课程大纲.md`》与递进式单课讲义（`01-xxx.md`），并在理解用户课题意图后动态增删改（CRUD）该课题挂载的脚手架工具（`topic.toolkits`）；
  4. **强化学习后训练（`Post-training RL` · 舞台原位脚手架工具 `Toolkit`）**：只读文本不更新人类参数。通过寄生在 `Stage` 之上的原位脚手架工具（如 `shadowing` 影子跟读四阶镜头与录音回放对比、`feynman` 合书复述与苏格拉底追问、未来的 `midi` 乐器跟弹），逼迫大脑与身体前向生成（Rollout）并根据客观误差信号更新认知权重；
  5. **评测与权重合并（`Eval` · 结题沉淀）**：没有自己的思考与实训记录严禁结题（`pith_settle_topic`）；通过向导深水区反例与迁移追问检验后沉淀归档，提炼《核心认知总结》并反哺更新 `ME.md`。
- **一句话定位**：以任意可观测材料与课题意图为起点、由认知管家 Agent 动态拆解课程并编排前后端脚手架工具（`Toolkit`）、将大模型训练管线（Pre-train / SFT / RL / Eval）映射为人类认知内化闭环的个人注意力与自我训练系统。
- **明确不做什么（Non-goals & 红线）**：
  - ❌ 不做多聊天窗口（Session-based）的通用 AI 问答客户端；底层 AI 会话跑完即毁，用户只面对课题（`Topic`）与材料（`Material`）。
  - ❌ 不把输入窄化为纯电子书阅读器，也不做一键替代原著/源码的自动摘要机；讲义与走读必须锚定可核对的一手材料坐标（`IntrinsicLocator` / `path:line`）。
  - ❌ 不在用户设置面板暴露底层插件开关列表；工具（`Toolkit`）在显式材料导入时按启发式规则预挂载默认值，并支持用户与向导按课题意图动态 CRUD。
  - ❌ 不回退浏览器/系统自带机械语音，也不硬编码特定 Agent 的私有配置文件路径。

## 核心架构槽位与交互总则（Directory-as-Product）

| 架构槽位 | 代码目录映射 | 核心职责与用户闭环 |
| :--- | :--- | :--- |
| **课题看板与统一立项台** | [`src/core/engine/`](../src/core/engine/) & [`src/core/store/`](../src/core/store/) & [`src/workbench/compass.ts`](../src/workbench/compass.ts) | 聚合活跃 `exploring` 课题、已沉淀 `settled` 课题与今日焦点 15 分钟微动作（`nextAction`）；提供中央统一立项/投喂入口（支持任意文件、代码仓库绑定与一句话拆课立项），以纯文本 Markdown 唯一事实源串行落盘 |
| **多模态呈现舞台 (`Stage`)** | [`src/plugins/stage-reader/`](../src/plugins/stage-reader/) & [`src/plugins/stage-timeline/`](../src/plugins/stage-timeline/) | 解决“输入内容怎么显示”：渲染书籍、生成的课程讲义、源码文本与音视频字幕流，提供黄金版心按屏分页、跨缩放内在位置锚定（`IntrinsicLocator`）与底部播客甲板联动（详见 [2-stages.md](subsystems/2-stages.md)） |
| **学习脚手架工具 (`Toolkit` + `UI Protocol`)** | `src/plugins/dojo-*/` | 解决“怎么帮用户理解与训练”：每个 `Toolkit` 同时包含**后端向导编排契约（`whenToUse` 提示词 + 专属工具）**与**前端 `UI Protocol` 原位覆盖层（寄生于兼容 Stage 之上）**；支持显式资料导入时启发式默认挂载 + 向导理解课题后自由 CRUD（详见 [3-dojos.md](subsystems/3-dojos.md)） |
| **认知管家向导与按需语音** | [`src/plugins/guide-acp/`](../src/plugins/guide-acp/) & [`src/plugins/speech-service/`](../src/plugins/speech-service/) | 标准 ACP 协议向导协同（结合 `ME.md` 由浅入深拆解《`00-课程大纲.md`》与递进讲义、走读代码仓、动态 CRUD `topic.toolkits`、结题门禁）与 OpenAI 兼容神经语音伴读/转写（详见 [4-guide-speech-shells.md](subsystems/4-guide-speech-shells.md)） |
| **全平台统一图形工作台** | `src/workbench/` & [`src/shells/`](../src/shells/) | 全 Shell（Obsidian / Web / DSH）共享唯一一份首页立项看板与课题内五区图形界面（详见 [5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md)） |

### 空间与交互铁律（完整契约见 [subsystems/5-spatial-ui-and-slots.md](subsystems/5-spatial-ui-and-slots.md)）

1. **首页中央唯一立项入口 vs 课题内右侧向导栏（双场景零视觉分裂）**：
   - **首页（课题看板 `Compass Scene`）**：不展开右侧聊天边栏，仅在中央顶部提供**唯一统一立项/投喂入口**（支持一句话课题意图、拖入任意文件、绑定本地 Git 仓库）与今日 15 分钟焦点推荐；
   - **课题内（工作台 `Topic Scene`）**：左侧为 `Stage` 主舞台，右侧为向导侧边栏（如果是通过一句话拆课/仓库立项进入，右侧向导自动展开并立即规划《`00-课程大纲.md`》投射至左侧 Stage；如果是直接打开显式书籍阅读，右侧向导默认收起以专注阅读，顶栏與侧栏支持随时追加补充材料）。
2. **启发式默认工具挂载与顶栏/向导双向 CRUD**：
   - Agent 介入前，用户导入显式资料（如外文 EPUB/PDF、带字幕音视频、中文书籍/代码仓）时，系统自动根据启发式规则挂载初始 `Toolkit`（如外文材料挂 `interline`、音视频挂 `shadowing`、理解类/代码仓挂 `feynman`）；
   - Agent 介入后，可根据用户真实目标通过 `pith_configure_toolkits` 动态增删改 `topic.toolkits`；用户亦可在顶栏 `🛠` 工具菜单中随时手动开启/关闭任何已注册的 `Toolkit`。
3. **Toolkit 原位 `UI Protocol` 叠加与底部唯一准入边界**：
   - `Toolkit` 不另起独立弹窗，而是通过 `UI Protocol` 直接寄生在 `Stage` 目标段落/字幕句原位（如行间双语译文行、影子跟读四阶变形与原声/自录对比条、费曼原位遮罩与内联阐述框）；
   - **内容正下方区域（Bottom Area）唯独只有音频播放控制条（`.pith-media-deck`）允许进入**（实心停靠挤压阅读容器高度，零遮挡正文）。
4. **书卷黄金版心与纯净伴读**：
   - 电子书采用无横向滚动条的按屏分页，每章独立起页；框选非空正文时弹出 `[ 高亮 | 记笔记 | 问向导 | 复制 ]`；TTS 伴读仅提取纯粹原文朗读，绝不混读嵌入译文或代码块。

## 领域概念与不变量（Domain & Glossary）

| 业务概念 | 代码/Schema 标识 | 定义与不变量约束 |
| :--- | :--- | :--- |
| **工作区** | `Workspace` | 纯文本根目录（Obsidian 壳默认位于 Vault 下 `Pith/`），严禁使用废弃历史名称 |
| **学习者画像** | `Profile` (`ME.md`) | 全工作区唯一，记录已知领域、类比偏好与认知盲区；向导拆课与课题沉淀时持续更新 |
| **探索课题** | `Topic` (`topics/topic-<id>/topic.md`) | 注意力管理基本单元，含 `status: "exploring" \| "settled"`、`nextAction` 与可动态 CRUD 的 `toolkits` |
| **可观测材料** | `Material` (`materials/material-<id>/`) | 100% 只读的原始文件（`files/`）、绑定的本地 Git 仓库（`externalPath` + `commitSha`）或向导生成的递进课程讲义（`00-课程大纲.md`, `01-xxx.md`），附带阅读进度 `locator` |
| **舞台与脚手架工具** | `Stage` & `Toolkit` (`DojoToolkitDescriptor`) | `Stage` 是负责呈现材料的画布底板；`Toolkit` 是包含后端 AI 编排契约与前端原位 `UI Protocol` 覆盖层的学习脚手架（注：历史代码标识符中的 `dojo` 统一指代 `Toolkit`） |
| **内在位置坐标** | `IntrinsicLocator` | 与屏幕尺寸、字号无关的稳定定位符（文本块偏移、页码、媒体秒数或代码行区间 `repo:<sha>:<path>#L<a>-L<b>`） |
| **思考与实训记录** | `Note` & `SelectionAnchor` | 锚定在具体材料坐标与原文引用（`quote`）上的高亮（`highlight`）、笔记（`note`）与实训诊断（`practice`） |
| **向导与表层皮肤** | `Guide` & `SurfacePersona` | 内核固定使用中性词 `Guide`；界面层通过 [`DEFAULT_PERSONAS`](../src/core/types.ts) 解耦皮肤文案 |
