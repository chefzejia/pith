# Pith

> **Agents automate your output. Pith grows your core.**
> **当所有 AI 都在替你加速输出，Pith 留你慢下来长出内核。**

Pith 是一个宿主无关的**个人注意力与深度内化系统（Personal Attention & Mastery System）**。它采用受 [magpie](../../infra/magpie) 与 [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) 启发的**「极简强主干（`src/core`）+ 可开关内置插件（`src/plugins`）+ 多态原生宿主壳（`src/shells`）」**架构。

## 按序阅读（Ordered Documentation）

每一篇编号文档只依赖它之前的文档，不引用后续未引入的概念：

- [000 Philosophy](docs/000-philosophy.md)：注意力守恒定律、慢输入与内化哲学
- [001 Domain Model](docs/001-domain.md)：四大持久领域概念（`Profile` · `Topic` · `Material` · `Note`）与去隐喻化词表
- [002 Architecture](docs/002-architecture.md)：`Core`、`PluginRuntime`（`InUse` 保活与逆序 `OnDispose`）、`HostPort` 与多壳设计
- [003 Interaction & Spatial Design](docs/003-interaction.md)：空间布局、左侧统一导航抽屉、底部悬浮 Dojo Dock、正文伴读微反应与极简图标开关铁律

## 三条铁律（Hard Invariants · 由 `tests/boundaries.test.ts` 强制守卫）

1. **单向依赖与插件隔离（`PluginsImportOnlyCore`）**：
   - `src/core/` 绝不导入 `src/plugins/` 或 `src/shells/`；
   - `src/plugins/<id>/` 之间绝不互相导入（仅允许通过 `ctx.provide` / `ctx.service` 通信）；只有 `src/plugins/all.ts` 汇总导入所有内置插件。
2. **宿主零泄漏（`Host-Agnostic Core & Plugins`）**：
   - 除 `src/shells/obsidian/` 外，全仓任何文件严禁导入 `"obsidian"`；除 `src/shells/dsh/` 外，全仓严禁导入 `@deepseek-ai/*` 宿主包。所有文件、网络、密钥、音频与系统能力均通过 `HostPort`（`src/core/host.ts`）注入。
3. **内核去隐喻化（`Metaphor-Free Core`）**：
   - 内核与持久化协议仅使用中性领域词：`Workspace`、`Profile`（`ME.md`）、`Topic`、`Material`、`Note`、`Anchor`、`Guide`。“花园（Garden）/ 园丁（Gardener）”等温度感表达仅作为 User 表层 Persona 字典存在，绝不侵入内核类型与存储协议。

## 验证

```bash
npm run typecheck
npm test
```
