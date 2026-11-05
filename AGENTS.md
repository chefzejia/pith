# Pith

> **Agents automate your output. Pith grows your core.**
> **当所有 AI 都在替你加速输出，Pith 留你慢下来长出内核。**

Pith 是一个宿主无关的**个人注意力与深度内化系统（Personal Attention & Mastery System）**，采用「纯文本与状态机内核（`src/core`）+ 按需挂载的内置插件（`src/plugins`）+ 多态原生宿主壳（`src/shells`）」三层单向架构。

## 核心约束

1. **单向依赖与插件隔离（`PluginsImportOnlyCore`）**：`src/core/` 绝不导入 `src/plugins/` 或 `src/shells/`；`src/plugins/<id>/` 之间绝不互相导入（仅通过 `ctx.provide` / `ctx.service` 通信），仅由 `src/plugins/all.ts` 汇总注册。
2. **宿主零泄漏（`Host-Agnostic Core & Plugins`）**：`src/core/**` 与 `src/plugins/**` 严禁导入 `node:*`、`"obsidian"` 或 `@deepseek-ai/*`；所有存储、网络、密钥与子进程能力统一经由 `HostPort`（`src/core/host.ts`）注入，且 ACP 插件只走标准协议，严禁硬编码读取特定 Agent 的私有配置文件。
3. **内核去隐喻化与 Agent 编排原则**：内核仅使用中性领域词（`Workspace`, `Profile`, `Topic`, `Material`, `Note`, `Anchor`, `Guide`）；插件由内核与向导 Agent 按需编排（`topic.toolkits`），严禁在 UI 设置中向用户暴露底层插件开关列表。
4. **标准外部/按需语音协议与 Fail-Closed**：衍生音频通过材料目录标准文件解耦；实时 TTS/ASR 通过 OpenAI 兼容 HTTP 协议对接云端或 Vault 外本机按需语音网关（原生 `sherpa-onnx` + `Kokoro-82M v1.1-zh` / `SenseVoice`），严禁回退系统低劣语音 API（`speechSynthesis`）或运行时调 `pip`，不可达时直接 Fail-Closed。
5. **双环四角色验证切分、手动破壁与审计账本**：
   - **工程自检与手动破壁归 Worker**：开工必读 [`docs/LESSONS.md`](docs/LESSONS.md)；全仓类型检查、单测、架构守卫单测（`tests/boundaries.test.ts`）、**手动破壁验证（`Broken by hand, each red`）**与构建同步由 Worker 100% 跑通，并在业务 Commit Body 记录 `Why/Cause & Change`、`Tests`、`Broken by hand`、`Run`、`Not tried`；
   - **模拟真实用户（首轮穷尽）归 Tester，战术自闭环归 Router**：Tester 在 `.gitignore` 专用沙盒（`.dev-vault` / `.tmp`）中按产品形态完全模拟真实用户操作与截屏视觉审视（首轮一次性穷尽缺陷）；显性缺陷由 Router 亲自记入 `LESSONS.md`（满 `Seen 3×` 令 Worker 固化为守卫单测）并在执行环内部直接拍板闭环，战略/契约冲突才标 `blocked` 报 Brain。

## 修改与验证

```bash
npm run typecheck          # TypeScript 全仓零报错检查
npm test                   # 运行全仓单测与架构边界守卫（tests/boundaries.test.ts）
npm run build:obsidian     # 打包 dist/obsidian/ 并自动同步至 .dev-vault/.obsidian/plugins/pith/
npm run verify:obsidian    # 拉起真实 /Applications/Obsidian.app (.dev-vault) 执行 CDP 端到端真机验收
npm run web                # 启动独立 Web 桌面壳 (默认 http://127.0.0.1:4173)
```

## 按需路由

- [当前交接](docs/HANDOFF.md)：查看滑动任务栈队列（`pending / in_progress / verified / blocked`）时读取。
- [产品定义](docs/PRODUCT.md)：确认产品定位、核心模块、空间交互铁律或领域词表时读取。
- [架构契约](docs/ARCHITECTURE.md)：修改三层单向依赖、子系统契约、公共接口或数据所有权时读取。
- [经验教训](docs/LESSONS.md)：排查已知失败模式、复盘打回原因或晋升守卫单测时读取。
- [协作角色](docs/ROLES.md)：执行 Brain / Router / Worker / Tester 双环四重身份协作时读取。
