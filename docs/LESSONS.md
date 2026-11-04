<!-- reviewed-through: dc49e6d (2026-11-04 17:15 +0800) -->
# Lessons from Merged Work

## Active Lessons

**修改现有 UI 或服务逻辑时，必须直接编辑原函数并删除废弃分支，严禁在文件末尾用同名函数重赋值包装链（`const xBase = x; x = ...`）或 `stopImmediatePropagation()` 覆盖旧监听器。**
- 重赋值包装链与事件截胡会让死代码残留，导致单元测试测试旧中间态而生产环境运行外层补丁，产生严重的状态漂移。
- 真实翻车证据：`src/shells/web/server.ts` 在 Wave 6 ~ Wave 11 期间将 `renderTraining` 连续包装 5 层，并在末尾用捕获阶段 `stopImmediatePropagation()` 屏蔽旧设置入口，导致 `tests/wave8-asr-tester-regressions.test.ts` 验证已失效的旧代码。
- Seen 5× (2026-11-03, 2026-11-04).

**测试必须调用真实導出的模块函数或在真实浏览器/宿主 DOM 中验证，严禁通过 `readFile("src/...")` 按行抠取源码字符串塞入 `vm.runInContext` 或构造跳过构造函数的伪实例（`Object.create(View.prototype)`）。**
- 抠取源码字符串行做测试会反向绑架生产代码结构（删一行死代码测试就崩），且无法发现真实 DOM 布局与事件传播缺陷。
- 真实翻车证据：`tests/wave8-asr-tester-regressions.test.ts:41`、`tests/core-epub-and-typography.test.ts:276`、`tests/obsidian-e2e-safety.test.ts:24` 均从源码切字符串进 `vm` 执行。
- Seen 4× (2026-11-03, 2026-11-04).

**外部或用户材料（EPUB / Markdown / 网页剪藏）净化渲染进 Pith 舞台时，必须剥离宿主保留命名空间（`pith-*` 类名与 `data-*` 属性），且章节容器查询必须使用直接子选择器或显式章节属性，不得依赖全局 `.querySelectorAll(".pith-epub-chapter")[i]`。**
- 若原书 HTML 含 `class="pith-epub-chapter"` 或保留属性，全局选择器下标会错位，导致跨章链接、伴读章节识别与目录高亮跳向伪造节点。
- 真实翻车证据：`[Task #12]`（`dc49e6d`）连续 3 轮修补链接目标，第 3 轮因原书正文可包含 `.pith-epub-chapter` 干扰 `article.querySelectorAll(".pith-epub-chapter")[target.chapter]` 而阻塞。
- Seen 3× (2026-11-04).

**独立 Tester 首轮验收必须一次性穷尽同切面的所有静态边界与动态交互缺陷（必要时由 Router 并行扇出静态审查与真机 E2E），严禁挤牙膏式每轮只报 1 个小点耗尽 3 轮额度。**
- 每次退回重跑 Worker + Tester 耗时 10~20 分钟；若同一模块的三处边界问题分三轮逐个报出，会无故触发 3 轮上限导致假性 `blocked`。
- 真实翻车证据：`[Task #12]` 中扁平化元素 id、SVG fragment 前缀、伪造章节类名本属同一 `epub.ts` + `pagination.ts` 链接解析切面，却分三轮逐次报出。
- Seen 3× (2026-11-03, 2026-11-04).

**构建与真机验证脚本（`scripts/`）直接操作已列入 `.gitignore` 的 `.dev-vault` 与 `.tmp` 沙盒，严禁编写快照回滚还原、硬链接防御或 `assertNoObsidian` 全局进程拦截。**
- 对专用测试沙盒做快照回滚不仅会在 `.tmp/` 堆积上万个备份垃圾文件，还会在验收后把 `.dev-vault` 新构建的插件回滚成旧版本，且因宿主机开着用户正常 Obsidian 而拒绝执行测试。
- 真实翻车证据：`920c1d5` 与 `56dfaba` 中 `scripts/obsidian-safety.mjs`、`scripts/verify-obsidian.mjs` 反复引入快照回滚与全局进程封锁。
- Seen 3× (2026-11-03, 2026-11-04).

## Moved to Guard Tests / Standards

- **核心包与插件隔离、宿主零泄漏、零系统低劣语音与外部仓库硬编码** → 已固化为守卫测试 `tests/boundaries.test.ts`。
