# 功能台账（Feature Ledger）

本文回答三件事：现在什么能用、凭什么、还缺什么。产品应该是什么见 [PRODUCT.md](PRODUCT.md) 与 [ARCHITECTURE.md](ARCHITECTURE.md)，正在做什么见 [TASKS.md](TASKS.md)。本文只记状态，不重复契约；「提议」一节不是契约，不据此派任务或实现。

## 读法

- **状态**
  - `已验收`：独立 Tester 按真实用户路径验收通过。
  - `待复验`：验收过，但之后的重构或契约变更动到了它，还没有重新独立验收；自动化测试可能仍然通过。#51（11-13）重写了磁盘格式和全部写入链路，在它之前验收、之后没有再独立验收的条目都记为待复验。
  - `契约`：契约已写明，但没有独立验收记录（可能未实现、部分实现，或只有自动化测试）。
  - `提议`：还没写进契约的想法，见「提议」一节。
- **Web / Obsidian**：`✓` 最近一次独立验收覆盖了该宿主；`○` 只有自动化测试；`–` 不适用，或还没有实现。
- **最近独立验收**：`#任务 @提交（日期）`，提交是 TASKS 中该任务的 `Verified-Commit`。标「受控」的表示验收用了受控夹具（音频、下载、模型回复等），不代表真实服务。
- **证据**：验收报告与截图在执行环本机的 `.tmp/evidence/milestone-<ID>/`，不进 git，也会被清理；本文只记结论、提交与缺口。
- **维护**：Brain 增删条目与提议。里程碑区块用 `Features` 字段列出它推进或动到的条目；Router 结案时按验收报告同步这些行，独立验收通过的写新的验收提交，动到但没验的降为待复验（[ROLES.md](ROLES.md)「功能台账同步」）。已知缺口写一句结论，细节留在提交正文与证据目录。条目按「用户会说我能做某件事」来切，契约细节留在 `docs/subsystems/`。

## 发布与版本

- **当前发布版本**：v0.1.0（#54 @0751ce1，已安装默认 ganfan-media Vault；附注标签 `v0.1.0`）。费曼旧追问的 F2 保留为已知缺口；追问将重新设计，不阻塞发布。
- **发布与开发分开**：日常用发布版本，装在默认 Vault，版本号即 Obsidian 插件列表里的 `version`；开发在 `main` 上继续，只进 `.dev-vault` 与 `.tmp` 沙盒，不碰真实 Vault。发布、打标签与补丁的规则见 [ROLES.md](ROLES.md)「发布步骤」。
- 版本按使用优先级排列：

| 版本 | 内容 | 状态 |
| :--- | :--- | :--- |
| v0.1.0 · 文本主链 | 学本地 Git 仓库（先克隆到本机，再在首页贴本地路径和想搞懂的问题）、读 PDF 与 EPUB、记笔记、费曼复述、结题。Web 与 Obsidian 各走一遍从投喂到结题的十段用户路径（G1–G10），覆盖 F-INTAKE-FILE、F-INTAKE-LINK、F-INTAKE-REPO、F-READ-REPO、F-READ-POS、F-READ-PDF、F-NOTES-MATERIAL、F-FROM-MATERIAL、F-INTAKE-TOPIC、F-LESSONS、F-ADD-MATERIAL、F-TOPIC-NOTES、F-TURN、F-TOOLKIT-MENU、F-FEYNMAN、F-SHELVE、F-OFFLINE、F-SANDBOX、F-SETTLE、F-PROFILE-OBS、F-UNREADABLE；不覆盖语音、影子跟读与音视频 | 已发布（#54；F2 为已知缺口，F-SANDBOX 待复验） |
| 自用 | 装好 v0.1.0 后，用几个真实仓库把 Pith 用起来；遇到的问题交给 Brain 分诊，确认要做的才进 [TASKS.md](TASKS.md) | v0.1.0 已安装，待开始 |
| v0.2.0 · 学 GitHub 仓库 | F-REPO-SEARCH（#58）、F-INTAKE-GITHUB（#59）、F-REPO-VERSIONS 与 F-LESSON-VERSION（#60；批量调整由 #64 改为程序判断受影响的讲），实现与发布验收在 #64。费曼保持 v0.1.0 行为，不阻塞发布。验收用你要学的仓库：magpie、deepseek-harness（本地）与 herdr、t3code（GitHub） | 实现与发布验收中（#64） |
| v0.3.0 · 费曼复述重做 | 去掉复述后的自动向导追问；看完原文可以「再复述一次」，变化的条目标出上一次的状态（#63） | 已排期 |
| v0.4.0 · 读书与阅读规划 | 电子书导入（EPUB、PDF 已验收，CBZ 没有验收记录）；向导按目录规划阅读路线；今日下一步复验（F-NEXT-ACTION）。「规划阅读任务」要做成什么样，等用过 v0.1.0 再定 | 待定义 |
| v0.5.0 · 英伦腔 | 先复验多媒体主链（F-READ-MEDIA、F-SPEECH-READ、F-SPEECH-RUNTIME、F-SHADOWING、F-MEDIA-CORPUS，4 条真实语音浏览器用例默认跳过），再设计 P-ACCENT | 待定义 |

- **之后**：处理各条目的已知缺口，或从「提议」里挑。

## 功能清单

#54 @0751ce1 表示 Brain 接受的组合终验：Web G1–G10 与原生 G1–G4 实际运行于 908aa0f，原生 G5–G10 与 Web F1 有限复验运行于 0751ce1；未重跑的专项在各行标明沿用，不把旧图算作最终版新证据。语音、影子跟读与音视频未在 #54 终验。

### 投喂与材料库

契约：[PRODUCT.md](PRODUCT.md)「运转模型」、[1-core §3](subsystems/1-core-store-engine.md)、[5-spatial §2](subsystems/5-spatial-ui-and-slots.md)

| ID | 用户能做什么 | 状态 | Web / Obsidian | 最近独立验收 | 已知缺口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| F-INTAKE-FILE | 拖入或选择文件导入材料库；同名的音视频与字幕合成一份；只有一份时直接打开阅读 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 本轮只用 Markdown 与一个可选字短 PDF；同名音视频/字幕合成沿用 #52，未作播放终验 |
| F-INTAKE-LINK | 贴一个 http(s) 链接，抓取网页正文成为材料 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 首页裸链接与课题内入口已覆盖；只用过 example.com 等少量公开页面，未扩外网故障矩阵 |
| F-INTAKE-REPO | 贴本地 Git 仓库路径，绑定当前提交成为材料 | 已验收 | ✓ / ✓ | #59 @71260bf（11-18） | 双端 magpie/deepseek 副本绑定、同提交复用和嵌套阅读通过；原生补验课题内添加及复用通过。先前三轮原生立项失败的原因未知；Cleanup PASS |
| F-INTAKE-GITHUB | 贴 GitHub 仓库链接，克隆到 Pith 的仓库目录（Vault 外），绑定默认分支的最新提交成为材料；私有仓库用本机已有的 git 凭据 | 已验收 | ✓ / ✓ | #59 @71260bf（11-18） | 双端公网导入、嵌套源码、复用、浅克隆无检出、pin、自然取消与错误通过；原生补验真实立项及课题内添加通过，立项耗时约 581 秒。旧 Agent 400 原因未知；私有仓成功及完整原始 MCP result 未覆盖；Cleanup PASS |
| F-REPO-VERSIONS | 仓库「检查更新」：有新提交就导入为新版本，旧版本不变；同一仓库的各版本在材料库合成一张卡片 | 待复验 | ○ / ○ | 无 | #60 两端版本导入通过；完整 Web 与 Obsidian 课题内版本路径由 #64 验收。 |
| F-LIBRARY | 首页材料库：封面、被几个课题引用、上次读到哪里，按最近打开排序 | 已验收 | ✓ / ✓ | #52 @d9aa705（11-14） | 宽窄变化用视口模拟，没有拖拽系统窗口 |
| F-UNREADABLE | 读不出来的课题和材料列在「无法读取」，写明路径与原因，不迁移、不修复 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 两份 #51 旧形状夹具被拒且原字节未变、合法项可用；不是旧应用生成的完整历史库，没有迁移或修复 |

### 阅读

契约：[2-stages](subsystems/2-stages.md)、[3-toolkits §3.1](subsystems/3-toolkits.md)、[4-guide §3](subsystems/4-guide-speech-shells.md)、[5-spatial §3](subsystems/5-spatial-ui-and-slots.md)

| ID | 用户能做什么 | 状态 | Web / Obsidian | 最近独立验收 | 已知缺口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| F-READ-MD | Markdown 与讲义：标题、列表、表格、代码块、教学卡片、链接 | 已验收 | ✓ / ✓ | #52 @d9aa705（11-14） | — |
| F-READ-EPUB | EPUB 按屏分页、跨章链接、封面，重开回到同一页 | 已验收 | ✓ / ✓ | #52 @d9aa705（11-14） | 没有穷举封面类型与危险路径 |
| F-READ-PDF | PDF：选字记笔记、按页跳回，改变尺寸后停在原页 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 本轮仅 ALPHA 可选字短 PDF 第 2 页选字/笔记回跳；扫描版、加密未测，连续尺寸保持沿用 #55 视口模拟 |
| F-READ-CBZ | CBZ 与单张图片按页阅读 | 契约 | ○ / ○ | 未找到记录 | — |
| F-READ-TEXT | 导入的源码、配置与纯文本按行渲染，可以选行记笔记 | 待复验 | ○ / ○ | #33 @4921555（11-10） | 仓库里的文件走同一个渲染器，见 F-READ-REPO |
| F-READ-REPO | 浏览仓库绑定提交里的文件，行号锚点；讲义里的 `path:line` 可以点开 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 本轮原生讲义没有可点来源链接，以正式材料记录回跳核对；讲义来源链接沿用 #52 |
| F-READ-POS | 删掉 `_cache` 重启后，仍回到上次打开的文件和位置 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 删整个 `_cache`、同库重启沿用 #52 专项；#54 只重开嵌套文件与位置，不保证像素级一致 |
| F-READ-MEDIA | 音视频配字幕时间轴，点字幕跳转；全系统只有底部一条播放条 | 待复验 | ○ / ○ | #40 @77895ee（11-11） | #52 只验了音视频与字幕合成一份材料，没有播放 |
| F-NOTES-MATERIAL | 材料阅读时高亮、记笔记；进入引用它的课题后仍然可见 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 本轮核对材料记录进入引用课题后可见与回跳；两课题隔离矩阵沿用 #52 |
| F-INTERLINE | 行间双语：原文、行间、译文主显三种模式，译文按材料缓存 | 已验收 | ✓ / ✓ | #52 @d9aa705（11-14） | 译文主显在重开后的表现没有测；原生没有单独核对两个课题间的行间状态 |
| F-SPEECH-READ | 神经语音伴读：只读正文，可跳回朗读处，和音视频共用播放条 | 待复验 | ○ / ○ | #38 @681a634（11-10） | 台账建立时没有找到真实本机语音的独立验收记录；4 条真实语音浏览器用例默认跳过 |
| F-SPEECH-RUNTIME | 安装本机语音运行时与模型：下载进度、断点续传、校验、取消；选择本机或云端音色 | 待复验 | ○ / ○ | #31 @d5ee65f（11-09） | 默认本机音色在 #31 之后改成 ZipVoice（6c877e3），之后没有独立验收 |

### 立项与课题

契约：[PRODUCT.md](PRODUCT.md)「运转模型」、[1-core §5](subsystems/1-core-store-engine.md)、[4-guide §2](subsystems/4-guide-speech-shells.md)、[5-spatial §2.2、§4、§6](subsystems/5-spatial-ui-and-slots.md)

| ID | 用户能做什么 | 状态 | Web / Obsidian | 最近独立验收 | 已知缺口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| F-INTAKE-TOPIC | 立项：一句话目标（可以带材料）交给向导，向导读材料后建课题，也可以先反问；失败或停止不留课题 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 没有自然观察到先反问；创建前停止沿用 #52，工具生效后的停止不承诺删除已写课题 |
| F-FROM-MATERIAL | 在材料阅读里「以此立项」 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | G4 从既有 Markdown 材料立项；没有扩展材料格式矩阵 |
| F-LESSONS | 课程大纲与逐讲讲义；目录里「待生成」的一讲点击即写 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 本轮真实大纲/讲义与目录切换通过；待生成点击即写沿用 #52，仅 Web 实测 |
| F-LESSON-VERSION | 讲义记下依据的仓库版本，出处只跳到这个版本；课题改用新版本时，引用的文件没变的讲自动改依据，变了的讲标出变化的文件，可以请向导按新版本重写这一讲 | 待复验 | ○ / ○ | 无 | #60 原生玩具路径通过；真实 magpie 双宿主调整未完成，Web 无写入，原生样本在调整前取消；详见 `.tmp/evidence/task-60/tester/adjustment-v2/final-report.md`，批量调整由 #64 改为程序判断受影响的讲、逐讲请向导重写。 |
| F-REPO-SEARCH | 向导在仓库绑定的提交里搜代码，结果带 `path:line` | 已验收 | ✓ / ✓ | #58 @dc0f7ae（11-18；搜索主链6354ed4，表格有限复验dc0f7ae） | GUI 成功 result 原始字节未完整导出，过滤/限额/准确作用域另有真实 Git/MCP 回归；保留上游中断与模型计数/解释偏差；仅核对静态调用，计时为 warm GUI 观测 |
| F-TURN | 课题对话：过程逐行出现、完成后折叠；能停止、能重新请求；给出选项或快捷动作 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 两端运行中停止后一次重新请求通过；工具写入途中停止未真实覆盖，#56 进程故障是受控夹具；provider 的 thinking/英文核对正文保留为 B1 品质边界 |
| F-ASK-SELECTION | 课题内框选正文「问向导」，带着原文发起一轮 | 契约 | ○ / ○ | 未找到记录 | — |
| F-TOPIC-NOTES | 课题内的高亮、笔记与向导批注，标明作者，点击跳回原文 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 本轮核对 user 笔记、材料只读记录分区与回跳；guide 总结见结题，两课题隔离沿用 #52 |
| F-ADD-MATERIAL | 课题内添加材料：从材料库选、选文件、贴链接或仓库路径；只增不减 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 本轮从材料库引用已有仓库材料且保留 ID；课题内文件/链接/路径入口沿用 #52 |
| F-SHELVE | 搁置与恢复课题，不经向导 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 离线搁置、恢复、重开后材料/记录/历史保留；没有扩展后台下一步矩阵 |
| F-NEXT-ACTION | 今日下一步：后台为进行中的课题生成一个 15 分钟内的行动 | 待复验 | ○ / ○ | #47 @d9a1c73（11-12，仅 Web） | — |
| F-OFFLINE | 没有向导时：投喂、阅读、记录、搁置照常；立项、课题回合、结题与行间翻译不可用并说明原因 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | F1 已在真实活课题复验：发送与历史动作禁用有原因，草稿引用保留，恢复后真实回合完成；原生当时无 retry/choices 且 quick 收起，这些由 Web 实际历史覆盖；原生未额外观察短英文链接的行间离线说明 |
| F-GUIDE-INGEST | 向导抓取公开网页或讨论，导入为材料并在课题里引用 | 待复验 | ○ / ○ | #50 @0d3aab3（11-13，仅 Web） | — |
| F-MEDIA-CORPUS | 向导搜索并拉取公开音视频与字幕，挂上影子跟读，切片导读写成讲义 | 待复验 | ○ / ○ | #39 @7418a54（11-11，受控下载与转写） | — |

### 训练工具

契约：[3-toolkits](subsystems/3-toolkits.md)、[5-spatial §5](subsystems/5-spatial-ui-and-slots.md)

| ID | 用户能做什么 | 状态 | Web / Obsidian | 最近独立验收 | 已知缺口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| F-TOOLKIT-MENU | 在顶栏开关训练工具；向导也可以按目标增删 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 本轮使用费曼入口；工具增删沿用 #52，仅 Web 实际增删，原生只核对菜单内容 |
| F-FEYNMAN | 费曼复述：先抽要点，提交后逐条对照原文，再自动发起一次向导追问 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 保存、自动回合与实际补答通过；追问仍在向导回合，首问 F2 仍失败：原生先给 missing 完整答案，Web 先指认遗漏，也可能多带小问；按 Brain 裁定作为已知缺口发布；#63 去掉自动追问、改为「再复述一次」（v0.3.0）；Web 入口不传取消信号（#63 修复），三类/故障/取消专项沿用 #53 |
| F-SHADOWING | 影子跟读：四阶练习、录音转写、漏词标在原句上 | 待复验 | ○ / ○ | #46 @6c7ea68（11-12，受控音频与转写） | #46 用的是静音音频和合成的麦克风输入 |

### 结题与画像

契约：[PRODUCT.md](PRODUCT.md)「运转模型」、[1-core §3.4](subsystems/1-core-store-engine.md)、[4-guide §2.5](subsystems/4-guide-speech-shells.md)

| ID | 用户能做什么 | 状态 | Web / Obsidian | 最近独立验收 | 已知缺口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| F-SETTLE | 结题：向导先问一道检验题；至少有一条你写的记录才能结题；写入《核心认知总结》；已沉淀的课题只读 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 本轮一次正常检验/回答/结题与重开只读；只有向导记录时「总结沉淀」快捷动作是否可用，仍未单独实测 |
| F-PROFILE-OBS | 画像：只在结题时追加「向导的观察」，写前留底，可在对话里撤销；你写的部分不改 | 已验收 | ✓ / ✓ | #54 @0751ce1（11-16） | 两端自由区未变、GUI 撤销观察通过；本轮各一次正常结题与撤销，失败恢复沿用分项受控证据 |

### 宿主与运行环境

契约：[ARCHITECTURE.md](ARCHITECTURE.md) 第一节、[4-guide §2.1、§2.4、§4](subsystems/4-guide-speech-shells.md)

| ID | 用户能做什么 | 状态 | Web / Obsidian | 最近独立验收 | 已知缺口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| F-AGENT | 在设置里选本机 Agent 当向导 | 已验收 | ✓ / ✓ | #56 @d8f5d4e（11-14） | 只登记了 dsh，claude 和 codex 选中后报不可用；切换模型与推理强度最近在 #26（11-09）验过 |
| F-SANDBOX | 向导只能经 Pith 工具改动工作区和绑定仓库，自带的写工具被拒 | 待复验 | ○ / ○ | #54 @0751ce1（11-16，仅工具失败观察） | G8 两端真实直接写工具失败、marker 字节未变，但 bash 后端不可用，未证明 OS 沙盒阻断；宿主系统沙盒仅 macOS 实现，仍待复验 |
| F-HOST-DSH | DSH 宿主壳：导出共享工作台与向导工具包 | 契约 | – / – | 未找到记录 | 没有打包成 DSH 插件，用户还不能在 DSH 里使用；只有单测覆盖工具包 |

## 提议（不是契约）

这里的想法没有进入契约，不派任务、不据此实现。Brain 把某条写进契约并派出任务后，它才进入功能清单。

### P-ACCENT · 口语腔调训练

- **来源**：原 [3-toolkits](subsystems/3-toolkits.md) 第 5 节与原 `docs/subsystems/6-language-acquisition.md`。
- **目标**：通过 Pith 习得目标口音（典型是英伦 RP）。判断有没有学会的信号在声学层，不在文字层。
- **已有基础**：影子跟读的四阶练习和词级漏词诊断；本机语音运行时（sherpa-onnx 上的 ZipVoice TTS 与 SenseVoice ASR，零 Python）。
- **缺口**：现有诊断比对的是转写后的文字。元音音色（如 /ɒ/ 与 /ɑː/）、非卷舌 r、辅音丛省略、语调起伏，在转写时就丢了。
- **候选路径**：
  1. 声学特征对比：用 TTS 生成目标腔调的参考音频，从用户录音提取 F0 曲线和共振峰，时间对齐后逐帧对比。纯 DSP，不加模型；能指出语调轮廓差多少，说不出是哪个音素。
  2. 音素识别：用 sherpa-onnx 生态里能输出音素的模型逐音素对齐，标出偏离的音素。更精确，但要下载新模型。
- **与现有约束的冲突**：原 6 号文档设想部署 Whisper.cpp 与 Piper，而 [boundaries.test.ts](../tests/boundaries.test.ts) 禁止语音运行时使用英文 Piper 模型和 whisper-tiny.en；它要求只用本地推理，而 [AGENTS.md](../AGENTS.md) 核心约束 4 允许云端语音。它设想的语谱图叠加、口腔发音部位可视化和 100ms 内反馈，都没有对应的契约。
- **进入设计前要回答**：ZipVoice 能否生成 RP 参考音频，还是要换或加 TTS 模型；两条路径的精度与工程量；`ToolkitDiagnosis` 要不要扩展，还是把声学特征放进 `result` 的 JSON。

### P-COGNITIVE-LOAD · 认知负荷管理

- **来源**：原 `docs/subsystems/7-cognitive-load.md`。
- **设想**：按认知负荷理论区分内在、外在与相关负荷。用户反复查询同一个复杂概念时，把长文重构成简洁的逻辑图（认知脚手架）；切换课题时生成「心跳总结」：上次停在哪、这次从哪开始、思路有什么变化。负荷指标设想从工具调用频率、笔记速度和上下文切换间隔里算。
- **与现有契约的张力**：自动调用脚手架绕开了「拆课经向导」的运转模型；三项指标都没有定义，也没有数据来源。
- **进入设计前要回答**：哪些信号能在不打扰阅读的前提下拿到；心跳总结能否先作为向导规则或「今日下一步」的一部分落地，而不新建子系统。

### P-MEMORY-RETRIEVAL · 记忆与提取

- **来源**：原 `docs/subsystems/8-memory-retrieval.md`。
- **设想**：写记录时附带情境线索（思维流、当时的高亮色与界面布局、设备状态）；把课题和材料映射成按提取难易排布的拓扑图；进入旧课题时重现当时的环境（记忆热身）；费曼复述卡住时，引导回到存储该概念时的情境，给线索而不给答案。
- **与现有契约的冲突**：新的拓扑存储和「语义 + 情境」双重向量查询，与「纯文本 Markdown 是唯一事实源」冲突；采集设备状态涉及隐私。
- **进入设计前要回答**：账本里已有的锚点、阅读位置与记录时间，能否单独支撑记忆热身。

### P-SCORE · 乐谱舞台与跟弹

- **来源**：[PRODUCT.md](PRODUCT.md) 把乐谱列为输入；[ARCHITECTURE.md](ARCHITECTURE.md) 第三节与 [3-toolkits](subsystems/3-toolkits.md) 的「扩展」以乐谱舞台加 MIDI 跟弹为例，说明一个插件可以同时贡献舞台和工具。
- **现状**：`.abc` 等文本乐谱只按纯文本逐行渲染。
- **进入设计前要回答**：先支持哪种乐谱格式；跟弹用什么确定性对齐来诊断。

## 回归测试

各条目当前对应的主要自动化测试，改动前后用 `npm run test:file -- <文件>` 回归；浏览器用例走 `npm run test:browser`。测试文件按历史任务命名，名字不代表覆盖范围。还没有实现的条目写 `—`，由实现它的任务补上。

| ID | 测试 |
| :--- | :--- |
| F-INTAKE-FILE | [task33-intake.test.ts](../tests/task33-intake.test.ts)、[task52-workbench.test.ts](../tests/task52-workbench.test.ts)、[task52-browser.test.ts](../tests/task52-browser.test.ts) |
| F-INTAKE-LINK | [task41-reading.test.ts](../tests/task41-reading.test.ts)、[task35-omnibox.test.ts](../tests/task35-omnibox.test.ts) |
| F-INTAKE-REPO | [task32-repository-guide.test.ts](../tests/task32-repository-guide.test.ts)、[task35-omnibox.test.ts](../tests/task35-omnibox.test.ts)、[task59-remote.test.ts](../tests/task59-remote.test.ts)、[task59-remote-browser.test.ts](../tests/task59-remote-browser.test.ts) |
| F-INTAKE-GITHUB | [task59-remote.test.ts](../tests/task59-remote.test.ts)、[task59-remote-browser.test.ts](../tests/task59-remote-browser.test.ts) |
| F-REPO-VERSIONS | [task60-versions.test.ts](../tests/task60-versions.test.ts)、[task60-versions-browser.test.ts](../tests/task60-versions-browser.test.ts) |
| F-LIBRARY | [task29-board.test.ts](../tests/task29-board.test.ts)、[audit11713-card-browser.test.ts](../tests/audit11713-card-browser.test.ts)、[audit11713-cover.test.ts](../tests/audit11713-cover.test.ts) |
| F-UNREADABLE | [task44-unreadable.test.ts](../tests/task44-unreadable.test.ts)、[task51-store.test.ts](../tests/task51-store.test.ts) |
| F-READ-MD | [track2-reader-speech.test.ts](../tests/track2-reader-speech.test.ts)、[wave2-trackA-plugins.test.ts](../tests/wave2-trackA-plugins.test.ts) |
| F-READ-EPUB | [core-epub-and-typography.test.ts](../tests/core-epub-and-typography.test.ts)、[wave12-epub-links.test.ts](../tests/wave12-epub-links.test.ts)、[wave13-pagination-browser.test.ts](../tests/wave13-pagination-browser.test.ts)、[audit11713-cover-browser.test.ts](../tests/audit11713-cover-browser.test.ts) |
| F-READ-PDF | [task55-pdf-node.test.ts](../tests/task55-pdf-node.test.ts)、[task55-pdf-browser.test.ts](../tests/task55-pdf-browser.test.ts)、[task55-resize-browser.test.ts](../tests/task55-resize-browser.test.ts) |
| F-READ-CBZ | [wave3-track1-reader-formats.test.ts](../tests/wave3-track1-reader-formats.test.ts) |
| F-READ-TEXT | [task33-intake.test.ts](../tests/task33-intake.test.ts) |
| F-READ-REPO | [task32-repository-guide.test.ts](../tests/task32-repository-guide.test.ts)、[task52-permanent-reading.test.ts](../tests/task52-permanent-reading.test.ts) |
| F-READ-POS | [task52-permanent-reading.test.ts](../tests/task52-permanent-reading.test.ts)、[task52-permanent-reading-browser.test.ts](../tests/task52-permanent-reading-browser.test.ts) |
| F-READ-MEDIA | [task38-transport-browser.test.ts](../tests/task38-transport-browser.test.ts)、[task38-narrow-transport-browser.test.ts](../tests/task38-narrow-transport-browser.test.ts)、[wave7-responsive-and-media-deck.test.ts](../tests/wave7-responsive-and-media-deck.test.ts) |
| F-NOTES-MATERIAL | [task52-material-notes-browser.test.ts](../tests/task52-material-notes-browser.test.ts) |
| F-INTERLINE | [toolkit-interline.test.ts](../tests/toolkit-interline.test.ts)、[task14-interline-browser.test.ts](../tests/task14-interline-browser.test.ts)、[task41-interline-progress.test.ts](../tests/task41-interline-progress.test.ts) |
| F-SPEECH-READ | [track2-reader-speech.test.ts](../tests/track2-reader-speech.test.ts)、[task15-speech-web-browser.test.ts](../tests/task15-speech-web-browser.test.ts)、[task15-speech-obsidian-browser.test.ts](../tests/task15-speech-obsidian-browser.test.ts) |
| F-SPEECH-RUNTIME | [task15-speech-runtime.test.ts](../tests/task15-speech-runtime.test.ts)、[task28-speech-download.test.ts](../tests/task28-speech-download.test.ts)、[task30-speech-voices.test.ts](../tests/task30-speech-voices.test.ts) |
| F-INTAKE-TOPIC | [task52-workbench.test.ts](../tests/task52-workbench.test.ts)、[task51-tools.test.ts](../tests/task51-tools.test.ts)、[engine.test.ts](../tests/engine.test.ts) |
| F-FROM-MATERIAL | [task52-browser.test.ts](../tests/task52-browser.test.ts) |
| F-LESSONS | [task36-curriculum.test.ts](../tests/task36-curriculum.test.ts)、[task52-directory-browser.test.ts](../tests/task52-directory-browser.test.ts) |
| F-LESSON-VERSION | [task60-versions.test.ts](../tests/task60-versions.test.ts)、[task60-versions-browser.test.ts](../tests/task60-versions-browser.test.ts) |
| F-REPO-SEARCH | [task58-repository-search.test.ts](../tests/task58-repository-search.test.ts)、[task58-table-browser.test.ts](../tests/task58-table-browser.test.ts) |
| F-TURN | [task49-turns.test.ts](../tests/task49-turns.test.ts)、[task56-acp-recovery.test.ts](../tests/task56-acp-recovery.test.ts)、[task56-recovery-browser.test.ts](../tests/task56-recovery-browser.test.ts)、[task50-guide-browser.test.ts](../tests/task50-guide-browser.test.ts) |
| F-ASK-SELECTION | [task52-browser.test.ts](../tests/task52-browser.test.ts)、[wave13-reader-behavior-browser.test.ts](../tests/wave13-reader-behavior-browser.test.ts) |
| F-TOPIC-NOTES | [task51-store.test.ts](../tests/task51-store.test.ts)、[task52-browser.test.ts](../tests/task52-browser.test.ts) |
| F-ADD-MATERIAL | [task52-workbench.test.ts](../tests/task52-workbench.test.ts)、[audit11713-card-browser.test.ts](../tests/audit11713-card-browser.test.ts) |
| F-SHELVE | [task51-store.test.ts](../tests/task51-store.test.ts) |
| F-NEXT-ACTION | [engine.test.ts](../tests/engine.test.ts) |
| F-OFFLINE | [task35-omnibox.test.ts](../tests/task35-omnibox.test.ts)、[engine.test.ts](../tests/engine.test.ts) |
| F-GUIDE-INGEST | [wave4-trackA-speech-timeline-ingest.test.ts](../tests/wave4-trackA-speech-timeline-ingest.test.ts)、[audit-4e6422f.test.ts](../tests/audit-4e6422f.test.ts) |
| F-MEDIA-CORPUS | [task37-media.test.ts](../tests/task37-media.test.ts)、[task39-browser.test.ts](../tests/task39-browser.test.ts) |
| F-TOOLKIT-MENU | [toolkit-menu-browser.test.ts](../tests/toolkit-menu-browser.test.ts)、[task52-workbench.test.ts](../tests/task52-workbench.test.ts) |
| F-FEYNMAN | [task53-feynman.test.ts](../tests/task53-feynman.test.ts)、[task53-feynman-browser.test.ts](../tests/task53-feynman-browser.test.ts)、[task53-prepare-cancellation.test.ts](../tests/task53-prepare-cancellation.test.ts) |
| F-SHADOWING | [task34-shadowing-browser.test.ts](../tests/task34-shadowing-browser.test.ts)、[task18-shadowing-multilingual.test.ts](../tests/task18-shadowing-multilingual.test.ts) |
| F-SETTLE | [task19-settlement.test.ts](../tests/task19-settlement.test.ts)、[task51-tools.test.ts](../tests/task51-tools.test.ts) |
| F-PROFILE-OBS | [task19-settlement.test.ts](../tests/task19-settlement.test.ts)、[audit11713-recovery.test.ts](../tests/audit11713-recovery.test.ts)、[audit11713-browser.test.ts](../tests/audit11713-browser.test.ts) |
| F-AGENT | [track1-guide-providers.test.ts](../tests/track1-guide-providers.test.ts)、[task15-acp-settings-browser.test.ts](../tests/task15-acp-settings-browser.test.ts) |
| F-SANDBOX | [task49-host-boundaries.test.ts](../tests/task49-host-boundaries.test.ts) |
| F-HOST-DSH | [plugins-and-shells.test.ts](../tests/plugins-and-shells.test.ts)、[wave3-track2-guide-tools.test.ts](../tests/wave3-track2-guide-tools.test.ts) |
