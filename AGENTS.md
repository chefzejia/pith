# Pith

> **We used all human wisdom to train AI. Pith uses AI's training pipeline to train you.**
> **全人类都在拿智慧训练大模型；Pith 借大模型的方法，训练你自己。**

Pith 是一个宿主无关的**个人注意力与人类认知训练系统（Personal Attention & Human Training System）**，采用「零依赖领域内核（`src/core`）+ 按需挂载的内置插件（`src/plugins`）+ 全平台统一图形工作台（`src/workbench`）+ 多态原生宿主薄壳（`src/shells`）」四层单向架构（全 Shell 100% 统一 UI 与交互）。

## 核心约束

1. **四层单向依赖与插件隔离（`Concentric 4-Layer DAG`）**：`src/core/` 绝不导入上层；`src/plugins/<id>/` 仅导入 `src/core/` 且插件之间绝不互相导入（仅由 `src/plugins/all.ts` 汇总注册）；`src/workbench/` 仅导入 `src/core/` 与 `src/plugins/` 并提供全 Shell 唯一一份共享工作台 UI（严禁各 Shell 各自复制维护第二套 DOM/CSS）；`src/shells/` 根目录下严禁散落未归类的 `.ts` 文件。
2. **宿主零泄漏（`Host-Agnostic Core, Plugins & Workbench`）**：`src/core/**`、`src/plugins/**` 与 `src/workbench/**` 严禁导入 `node:*`、`"obsidian"` 或 `@deepseek-ai/*`；所有存储、网络、密钥、子进程与本机工具端点能力统一经由 `HostPort`（`src/core/host.ts`）注入。向导只走两条标准协议：ACP（会话与过程更新）与 MCP（Pith 工具）；严禁从回复文本里解析指令，严禁硬编码读取特定 Agent 的私有配置文件。
3. **材料永久、课题临时、向导把关（完整模型见 [`docs/PRODUCT.md`](docs/PRODUCT.md)「运转模型」）**：
   - **三个实体**：材料（`Material`）永久且导入后不变；课题（`Topic`）是一个能结题的问题，只引用材料，自己拥有讲义、对话与记录；画像（`ME.md`）里程序只增删「向导的观察」条目。课题只有一层，不设父子、文件夹或分组。
   - **四个动作**：投喂与阅读不需要向导，永远可用；立项与结题只能经向导工具（`pith_create_topic`、`pith_settle_topic`）完成，没有向导时不可用。
   - **插件角色**：`Core` 之外皆插件。舞台（`Stage`）负责渲染文件；工具（`Toolkit`）以原位覆盖层寄生在舞台上，分为挂在材料上的阅读辅助与挂在课题上的训练工具。这个概念只叫 `Toolkit`，不使用 `dojo`。严禁在用户设置面板暴露底层插件开关列表。
   - **格式演进**：代码只读当前格式，不保留旧格式的读取代码或兼容别名。还没发布过的设计有问题就直接改设计并重构；已发布的磁盘格式只做加法（新增可选字段），确需破坏性变更时先由人确认，由发布任务附一次性迁移脚本，先备份再迁移，迁移完删掉脚本。
4. **标准外部/按需语音协议与 Fail-Closed**：衍生音频通过材料目录标准文件解耦；实时 TTS/ASR 通过 OpenAI 兼容 HTTP 协议对接云端或 Vault 外本机按需神经语音网关（原生零 Python 依赖运行时），严禁回退系统低劣语音 API（`speechSynthesis`）或运行时调 `pip`，不可达时直接 Fail-Closed。
5. **双环协作（拓扑 A：单宿主原生编排 + 异源审计）**：采用 `multi-agent-collab` 拓扑 A，由主会话兼任 **Brain + Router**（维护契约与 [`docs/TASKS.md`](docs/TASKS.md) 队列，原 Codex `.git/hooks/post-commit` 唤醒已停用为 `post-commit.codex-disabled`），调度独立 AGY 子 Agent（`pith-worker`、每里程碑全新 `pith-tester`）执行实现与真实用户验收；按失效机制归类并晋升 [`docs/LESSONS.md`](docs/LESSONS.md) 守卫单测。重大方案定稿前（`plan`）及合并/发版/跳过 Tester/周期节点（`diff`）优先经 `gpt-auditor` 调用本机只读一次性异源 CLI 执行四类实证交叉审计，由 Brain 逐条核实后再清零推进水位线。全部规则以 [`docs/ROLES.md`](docs/ROLES.md) 为准。

## 修改与验证

```bash
npm run typecheck          # TypeScript 全仓零报错检查
npm test                   # 运行全仓单测与架构边界守卫（tests/boundaries.test.ts）；tests/setup.ts 把 HOME 与 PITH_SPEECH_HOME 指向一次性沙盒
npm run test:file -- tests/store.test.ts   # 在同一沙盒下运行指定测试文件（单跑文件一律走此入口）
npm run test:browser       # 逐个文件运行全部浏览器用例（自动探测 Playwright 与 Chrome，或设 PITH_PLAYWRIGHT_MODULE / PITH_CHROME_PATH；缺任一即报错退出）；改动 src/workbench/、src/shells/ 或舞台渲染后必跑
npm run build:obsidian     # 打包 dist/obsidian/ 并自动同步至 .dev-vault/.obsidian/plugins/pith/（不写仓库之外的任何路径）
npm run install:obsidian   # 构建后把三个插件文件安装进真实 Vault（参数 > PITH_OBSIDIAN_VAULT > 默认 Vault）；仅在发布里程碑（区块写明 `发布版本`）或人类明确要求时执行（docs/ROLES.md「发布步骤」）
npm run verify:obsidian    # 拉起真实 /Applications/Obsidian.app (.dev-vault) 执行 CDP 端到端真机验收
npm run web                # 启动独立 Web 桌面壳 (默认 http://127.0.0.1:4173)
```

## 按需路由

- [里程碑调度板](docs/TASKS.md)：查看里程碑队列（`pending / verified / blocked / superseded`）、前置（`Depends-On`）与写作用域（`Scope`）时读取。
- [产品定义](docs/PRODUCT.md)：确认产品定位、核心模块、空间交互铁律或领域词表时读取。
- [功能台账](docs/FEATURES.md)：查看各功能的实现与验收状态、已知缺口、里程碑与提议时读取；「提议」不是契约，不据此派任务或实现。
- [架构总纲](docs/ARCHITECTURE.md) 与 [子系统契约](docs/subsystems/1-core-store-engine.md)：修改四层单向依赖、子系统契约（[`1-core`](docs/subsystems/1-core-store-engine.md) / [`2-stages`](docs/subsystems/2-stages.md) / [`3-toolkits`](docs/subsystems/3-toolkits.md) / [`4-guide-speech-shells`](docs/subsystems/4-guide-speech-shells.md) / [`5-spatial-ui-and-slots`](docs/subsystems/5-spatial-ui-and-slots.md)）、公共接口或数据所有权时读取。`docs/` 描述目标契约；哪些已经落地并通过验收、已知缺口在哪，见功能台账。
- [经验教训](docs/LESSONS.md)：排查已知失败模式、复盘打回原因或晋升守卫单测时读取。
- [协作角色](docs/ROLES.md)：执行 Brain / Worker / Tester / Auditor 协作时读取。
