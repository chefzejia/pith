# Pith

> **/pɪθ/** — 植物髓心、脊椎中枢、事物的精髓。
>
> **全人类都在拿智慧训练大模型；Pith 借大模型的方法，训练你自己。**

[English](README.md) | **简体中文**

Pith 是一个宿主无关的**个人注意力与人类认知训练系统（Personal Attention & Human Training System）**，运行在 [Obsidian](https://obsidian.md) 与独立 Web 桌面端中。

在 AI 时代，外部内容生成的边际成本趋近于零，信息噪音与焦虑叙事呈指数级爆炸，持续撕裂人类恒定且稀缺的注意力带宽。当 Agent 迈向 Super Agent，系统的最终瓶颈正回到人类自己身上：如果停止自身进化，把问题都丢给 AI「许愿」，或满足于看懂二手总结的流畅性错觉，人的底层心智权重就从未更新。人类倾尽智慧摸索出了训练顶尖大模型的完整范式；Pith 将这套训练管线逆向工程回来，用于训练人类自己。

---

## 人类认知训练管线

没有经过大脑「前向生成（Rollout）→ 暴露误差 → 反馈纠偏」的知识，不会转化为底层直觉。Pith 将大模型训练的五个阶段工程化为日常认知进化闭环：

| 训练阶段 | AI 模型训练 | 人类认知进化（理论 + 具身实践） | Pith 机制 |
| :--- | :--- | :--- | :--- |
| **0. 算力调度与基座权重**<br>*(Compute & Base Weights)* | 集中有限算力预算；维护基座模型权重 | **注意力防噪与个人基座**：屏蔽信息流焦虑，聚焦极少数活跃课题与 15 分钟下一步动作 | **课题看板、材料库与今日焦点** + **`ME.md`（个人认知基座）** |
| **1. 预训练**<br>*(Pre-training)* | 清洗高质量一手语料，建立底座表征 | **一手原始材料摄入**：拒绝二手摘要阉割，直接精读原书、原论文、源码与长播客 | **阅读与时间轴舞台（`stage-*`）** + **行间双语与神经伴读** |
| **2. 监督微调**<br>*(SFT)* | 高质量专家示范，对齐解题路径 | **因人施教的拆解与讲义生成**：由熟知你背景（`ME.md`）的向导把一个问题立成课题、拆解因果链、编写讲义并编排训练工具 | **向导（`guide-acp`）** |
| **3. 强化学习后训练**<br>*(Post-training / RL)* | 模型先 Rollout 生成 → 环境返回误差信号 → 更新梯度 | **具身与生成式实训**：撤除原文提示，通过跟读、复述与主动阐述暴露认知盲区 | **舞台原位训练工具（`toolkit-*`）** |
| **4. 评测与权重合并**<br>*(Eval & Merge)* | 跑 Benchmark 验证泛化与迁移能力，合并权重落盘 | **结题门禁与认知沉淀**：抗住反例与跨场景迁移检验；无思考与实训记录禁止结题 | **结题门禁** → 课题沉淀，观察条目写入 `ME.md` |

---

## 快速开始

```bash
npm install
npm run web                # 启动独立 Web 桌面壳 (默认 http://127.0.0.1:4173)
npm run build:obsidian     # 打包 dist/obsidian/ 并自动同步至 .dev-vault/.obsidian/plugins/pith/
```

## 常用命令

| 命令 | 用途 |
| :--- | :--- |
| `npm run typecheck` | TypeScript 全仓静态类型检查 |
| `npm test` | 运行全仓单元测试与架构边界守卫（[`tests/boundaries.test.ts`](tests/boundaries.test.ts)） |
| `npm run test:file -- <文件>` | 在与 `npm test` 相同的一次性 `HOME` / `PITH_SPEECH_HOME` 沙盒下运行指定测试文件 |
| `npm run test:browser` | 逐个文件运行全部浏览器用例；自动探测 Playwright 与 Chrome（或设 `PITH_PLAYWRIGHT_MODULE` / `PITH_CHROME_PATH`），缺任一即报错退出 |
| `npm run build:obsidian` | 构建 Obsidian 插件产物并同步至 `.dev-vault` 沙盒 |
| `npm run install:obsidian` | 构建后把 `main.js`、`styles.css`、`manifest.json` 安装进真实 Vault 的 `.obsidian/plugins/pith/`（Vault 路径取命令参数、`PITH_OBSIDIAN_VAULT` 或默认 Vault） |
| `npm run verify:obsidian` | 拉起隔离的真实 `/Applications/Obsidian.app`（`.dev-vault`）执行端到端真机验证 |
| `npm run web` | 启动独立 Web 桌面宿主壳 |

## 项目结构

- [`src/core/`](src/core/)：零宿主与 UI 框架依赖的领域内核（`PluginRuntime`、`WorkspaceStore`、`AttentionEngine`、[`HostPort`](src/core/host.ts) 与能力契约 [`seams.ts`](src/core/seams.ts)）。
- [`src/plugins/`](src/plugins/)：平级隔离的阅读/媒体舞台、阅读辅助与训练工具、标准 ACP 向导与语音服务插件，统一在 [`src/plugins/all.ts`](src/plugins/all.ts) 注册。
- `src/workbench/`：全 Shell（`obsidian`、`web`、`dsh`）共用的唯一一份工作台 UI（首页、材料阅读、课题内三个场景）。
- [`src/shells/`](src/shells/)：多态原生宿主薄壳适配器（`obsidian`、`web`、`dsh`、`speech`）。
- [`tests/`](tests/)：架构边界守卫单测与各子系统验证套件。

## 文档入口

- [`docs/PRODUCT.md`](docs/PRODUCT.md)：产品定位、核心模块、空间交互铁律与领域词表。
- [`docs/FEATURES.md`](docs/FEATURES.md)：功能台账，记录现在什么能用、在哪个宿主、凭什么、还缺什么，以及里程碑与提议。
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 与 [`docs/subsystems/`](docs/subsystems/1-core-store-engine.md)：四层单向依赖、五大子系统契约（[`1-core`](docs/subsystems/1-core-store-engine.md) · [`2-stages`](docs/subsystems/2-stages.md) · [`3-toolkits`](docs/subsystems/3-toolkits.md) · [`4-guide-speech-shells`](docs/subsystems/4-guide-speech-shells.md) · [`5-spatial-ui-and-slots`](docs/subsystems/5-spatial-ui-and-slots.md)）与数据所有权。
- [`AGENTS.md`](AGENTS.md)：Agent 协作边界、验证命令与按需路由。
