# Pith

> **Agents automate your output. Pith grows your core.**
> **当所有 AI 都在替你加速输出，Pith 留你慢下来长出内核。**

Pith 是一个宿主无关的**个人注意力与深度内化系统（Personal Attention & Mastery System）**，采用「极简强主干（`src/core`）+ Agent 动态调度的内置插件（`src/plugins`）+ 多态原生宿主壳（`src/shells`）」三层同心圆架构。

## 核心约束

1. **单向依赖与插件隔离（`PluginsImportOnlyCore`）**：`src/core/` 绝不导入 `src/plugins/` 或 `src/shells/`；`src/plugins/<id>/` 之间绝不互相导入（仅通过 `ctx.provide` / `ctx.service` 通信），仅由 `src/plugins/all.ts` 汇总注册。
2. **宿主零泄漏（`Host-Agnostic Core & Plugins`）**：`src/core/**` 与 `src/plugins/**` 严禁导入 `node:*`、`"obsidian"` 或 `@deepseek-ai/*`；所有存储、网络、密钥与子进程能力统一经由 `HostPort`（`src/core/host.ts`）注入。
3. **内核去隐喻化与 Agent 编排原则**：内核仅使用中性领域词（`Workspace`, `Profile`, `Topic`, `Material`, `Note`, `Anchor`, `Guide`）；插件由内核与向导 Agent 按需编排（`topic.toolkits`），严禁在 UI 设置中向用户暴露底层插件开关列表。
4. **通用外部语音协议与 Fail-Closed**：衍生音频通过材料目录标准文件（`.mp3/.m4a/.wav/.ogg` + `.vtt/.srt`）解耦；实时 TTS/ASR 通过标准 HTTP 协议接入外部服务，严禁回退系统自带低劣语音 API（`speechSynthesis` / `webkitSpeechRecognition`），不可达时直接 Fail-Closed。
5. **测试沙盒卫生与真实 Vault 保护**：单测与真机验证严禁触碰宿主机真实 Obsidian Vault 或用户个人目录；Obsidian 调试唯一固定复用仓库内 `.dev-vault`（数据收纳于 `Pith/` 命名空间下）。

## 修改与验证

```bash
npm run typecheck          # TypeScript 全仓零报错检查
npm test                   # 运行全部单测与架构边界守卫（tests/boundaries.test.ts）
npm run build:obsidian     # 打包生成 dist/obsidian/{main.js,manifest.json,styles.css}
npm run web                # 启动独立 Web 桌面壳 (默认 http://127.0.0.1:4173)
```

## 按需路由

- [当前交接](docs/HANDOFF.md)：跨会话继续工作或查看当前任务进展时读取。
- [协作角色](docs/ROLES.md)：启用 Brain / Worker / Tester 多角色分工时读取。
- [000 产品哲学](docs/000-philosophy.md)：注意力守恒定律、慢输入与具身内化原则。
- [001 领域模型](docs/001-domain.md)：四大持久领域实体（`Profile` · `Topic` · `Material` · `Note`）与去隐喻化词表。
- [002 架构契约](docs/002-architecture.md)：`Core`（`PluginRuntime` / `WorkspaceStore` / `AttentionEngine`）、内置插件分类与 `HostPort` 契约。
- [003 交互与空间设计](docs/003-interaction.md)：44px 极简顶栏、弹性工具胶囊槽、实心停靠播客甲板与跨设备连续几何自适应算法（`resolveResponsiveLayout`）。
