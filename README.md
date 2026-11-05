# Pith

Pith 是一个宿主无关的个人注意力与深度内化系统（Personal Attention & Mastery System），采用「纯文本与状态机内核（`src/core`）+ 按需挂载的内置插件（`src/plugins`）+ 多态原生宿主壳（`src/shells`）」架构。

## 快速开始

```bash
npm install
npm run web                # 启动独立 Web 桌面壳 (默认 http://127.0.0.1:4173)
npm run build:obsidian     # 打包 dist/obsidian/ 并同步至 .dev-vault/.obsidian/plugins/pith/
```

## 常用命令

| 命令 | 用途 |
| :--- | :--- |
| `npm run typecheck` | TypeScript 全仓静态类型检查 |
| `npm test` | 运行全仓单元测试与架构守卫单测（[`tests/boundaries.test.ts`](tests/boundaries.test.ts)） |
| `npm run build:obsidian` | 构建 Obsidian 插件产物并同步至 `.dev-vault` 沙盒 |
| `npm run verify:obsidian` | 拉起隔离的真实 `/Applications/Obsidian.app`（`.dev-vault`）执行端到端真机验证 |
| `npm run web` | 启动独立 Web 宿主壳 |

## 项目结构

- [`src/core/`](src/core/)：零宿主与 UI 框架依赖的领域内核（`PluginRuntime`、`WorkspaceStore`、`AttentionEngine`、`HostPort` 与能力接口 [`seams.ts`](src/core/seams.ts)）。
- [`src/plugins/`](src/plugins/)：平级隔离的舞台（`stage-reader`、`stage-timeline`）、实训工具（`dojo-interline`、`dojo-shadowing`、`dojo-feynman`）、向导（`guide-acp`）与语音底座（`speech-service`），仅在 [`src/plugins/all.ts`](src/plugins/all.ts) 汇总。
- [`src/shells/`](src/shells/)：多态原生宿主适配器（`obsidian`、`web`、`dsh`）与本机按需语音网关运行时（[`speechRuntime.ts`](src/shells/speechRuntime.ts)）。
- [`tests/`](tests/)：架构边界守卫单测与各子系统验证套件。

## 文档入口

- [AGENTS.md](AGENTS.md)：Agent 协作边界、验证命令与按需路由。
- [docs/PRODUCT.md](docs/PRODUCT.md)：产品定位、核心模块、领域概念与交互契约。
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：三层单向依赖、子系统薄契约、数据所有权与关键架构决策。
