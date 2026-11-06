# Pith

> **We used all human wisdom to train AI. Pith uses AI's training pipeline to train you.**
> **全人类都在拿智慧训练大模型；Pith 借大模型的方法，训练你自己。**

Pith 是一个宿主无关的**个人注意力与人类认知训练系统（Personal Attention & Human Training System）**，采用「零依赖领域内核（`src/core`）+ 按需挂载的内置插件（`src/plugins`）+ 全平台统一图形工作台（`src/workbench`）+ 多态原生宿主薄壳（`src/shells`）」四层单向架构（全 Shell 100% 统一 UI 与交互）。

## 核心约束

1. **四层单向依赖与插件隔离（`Concentric 4-Layer DAG`）**：`src/core/` 绝不导入上层；`src/plugins/<id>/` 仅导入 `src/core/` 且插件之间绝不互相导入（仅由 `src/plugins/all.ts` 汇总注册）；`src/workbench/` 仅导入 `src/core/` 与 `src/plugins/` 并提供全 Shell 唯一一份共享工作台 UI（严禁各 Shell 各自复制维护第二套 DOM/CSS）；`src/shells/` 根目录下严禁散落未归类的 `.ts` 文件。
2. **宿主零泄漏（`Host-Agnostic Core, Plugins & Workbench`）**：`src/core/**`、`src/plugins/**` 与 `src/workbench/**` 严禁导入 `node:*`、`"obsidian"` 或 `@deepseek-ai/*`；所有存储、网络、密钥与子进程能力统一经由 `HostPort`（`src/core/host.ts`）注入，且 ACP 插件只走标准协议，严禁硬编码读取特定 Agent 的私有配置文件。
3. **内核去隐喻化与 Agent 编排原则**：内核仅使用中性领域词（`Workspace`, `Profile`, `Topic`, `Material`, `Note`, `Anchor`, `Guide`）；插件由内核与向导 Agent 按需编排（`topic.toolkits`），严禁在 UI 设置中向用户暴露底层插件开关列表。
4. **标准外部/按需语音协议与 Fail-Closed**：衍生音频通过材料目录标准文件解耦；实时 TTS/ASR 通过 OpenAI 兼容 HTTP 协议对接云端或 Vault 外本机按需神经语音网关（原生零 Python 依赖运行时），严禁回退系统低劣语音 API（`speechSynthesis`）或运行时调 `pip`，不可达时直接 Fail-Closed。
5. **双环四角色验证切分、手动破壁与多 Worktree 流水线**：
   - **秒级内环自检与手动破壁归 Worker**：开工必读 [`docs/LESSONS.md`](docs/LESSONS.md)；全仓类型检查、单测、架构守卫单测（`tests/boundaries.test.ts`）、**手动破壁验证（`Broken by hand`）**与构建同步由 Worker 在秒级内环 100% 跑通，并在业务 Commit Body 简明记录意图/根因与验证证据；
   - **模拟真实用户（首轮穷尽）归 Tester，多 Worktree 与战术自闭环归 Router**：Tester 在 `.gitignore` 专用沙盒（`.dev-vault` / `.tmp`）中按产品形态完全模拟真实用户操作与截屏视觉审视（首轮一次性穷尽缺陷）；当主目录忙于验收或多任务 `Scope` 正交时，Router 在 `.tmp/worktrees/task-<ID>` 开启隔离 Worktree 并行派发 Worker（单测通过后变基合回 `main` 并立即销毁临时 Worktree）；显性缺陷由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 固化为守卫单测）并在执行环内部直接拍板闭环，战略/契约冲突才标 `blocked` 报 Brain。

## 修改与验证

```bash
npm run typecheck          # TypeScript 全仓零报错检查
npm test                   # 运行全仓单测与架构边界守卫（tests/boundaries.test.ts）
npm run build:obsidian     # 打包 dist/obsidian/ 并自动同步至 .dev-vault/.obsidian/plugins/pith/
npm run verify:obsidian    # 拉起真实 /Applications/Obsidian.app (.dev-vault) 执行 CDP 端到端真机验收
npm run web                # 启动独立 Web 桌面壳 (默认 http://127.0.0.1:4173)
```

## 按需路由

- [任务调度板](docs/TASKS.md)：查看滑动任务栈队列（`pending / in_progress / verified / blocked`）与写作用域（`Scope`）时读取。
- [产品定义](docs/PRODUCT.md)：确认产品定位、核心模块、空间交互铁律或领域词表时读取。
- [架构总纲](docs/ARCHITECTURE.md) 与 [子系统契约](docs/subsystems/1-core-store-engine.md)：修改三层单向依赖、子系统契约（[`1-core`](docs/subsystems/1-core-store-engine.md) / [`2-stages`](docs/subsystems/2-stages.md) / [`3-dojos`](docs/subsystems/3-dojos.md) / [`4-guide-speech-shells`](docs/subsystems/4-guide-speech-shells.md) / [`5-spatial-ui-and-slots`](docs/subsystems/5-spatial-ui-and-slots.md)）、公共接口或数据所有权时读取。
- [经验教训](docs/LESSONS.md)：排查已知失败模式、复盘打回原因或晋升守卫单测时读取。
- [协作角色](docs/ROLES.md)：执行 Brain / Router / Worker / Tester 双环四重身份协作时读取。
