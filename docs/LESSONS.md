<!-- reviewed-through: 183c625 (2026-11-05 18:10 +0800) -->
# Lessons from Merged Work

## Active Lessons

**原位训练关闭时应恢复目标正文的原始显示状态，不能遗留对齐或选择高亮。**
- `[Task #24]` Web 真实用户验收中，对齐中文漏词并记账后收起训练卡，正文仍整句高亮；工程回归未覆盖关闭后的视觉状态。
- Seen 1× (2026-11-07).

**跟读对齐必须覆盖无空格书写的文本，不能把不支持的字符集解析成空词列后报告“漏词：无”。**
- `[Task #18]` 双壳真实验收中，中文目标只复述前半句仍显示“漏词：无”；词法表达式仅识别拉丁字符和数字，现有工程检查未覆盖中文遗漏。
- Seen 1× (2026-11-06).

**音频启动或恢复的 `play()` 尚未完成时，不得允许暂停打断待完成的启动请求并将其误报为播放失败。**
- `[Task #16]` 原生验收观察到暂停时报 `play() request was interrupted`；双壳禁用启动期间的暂停并增加回归。原生复验普通暂停通过，但未复现原始竞态。
- Seen 1× (2026-11-05).

**存在真实 Obsidian 窗口时，验收只能绑定经确认属于测试 Vault 的独立目标，不得按应用名绑定。**
- `[Task #16]` 隔离实例启动失败后，按应用名绑定返回真实 Vault 窗口及无障碍内容；未操作该窗口。后续使用独立 CDP 目标核实 `.dev-vault`。
- Seen 1× (2026-11-05).

**异步听读结束时保留明确的完成或失败状态，不能仅凭播放控件消失判断音频已完整播放。**
- `[Task #15]` 独立验收在原生阅读器观察到朗读进度推进到 13/15，随后控件消失但无完成或错误提示，无法确认末尾是否播完。
- Seen 1× (2026-11-05).

**切换本机 ACP Agent 时，验证此前保存的模型和推理强度不会被误用于新 Agent；探测失败和空选项也应保留明确的界面状态。**
- `[Task #15]` 独立验收发现跨 profile 残留旧模型会导致 ACP 探测失败；修复后分别在 Web 和 `.dev-vault` Obsidian 复验。
- Seen 1× (2026-11-05).

**外部或用户材料（EPUB / Markdown / 网页剪藏）净化渲染进 Pith 舞台时，必须剥离宿主保留命名空间（`pith-*` 类名与 `data-*` 属性），且章节容器查询必须使用直接子选择器或显式章节属性，不得依赖全局 `.querySelectorAll(".pith-epub-chapter")[i]`。**
- 若原书 HTML 含 `class="pith-epub-chapter"` 或保留属性，全局选择器下标会错位，导致跨章链接、伴读章节识别与目录高亮跳向伪造节点。
- 真实翻车证据：`[Task #12]`（`dc49e6d`）连续 3 轮修补链接目标，第 3 轮因原书正文可包含 `.pith-epub-chapter` 干扰 `article.querySelectorAll(".pith-epub-chapter")[target.chapter]` 而阻塞，后在 `e9c0f0f` 剥离 `pith-*` 类名修复。
- Seen 3× (2026-11-04).

**独立 Tester 首轮验收必须一次性穷尽同切面的所有静态边界与动态交互缺陷，严禁挤牙膏式每轮只报 1 个小点耗尽 3 轮额度。**
- 每次退回重跑 Worker + Tester 耗时较长；若同一模块的多处边界问题分三轮逐个报出，会无故触发 3 轮上限导致假性 `blocked`。
- 真实翻车证据：`[Task #12]` 中扁平化元素 id、SVG fragment 前缀、伪造章节类名本属同一 `epub.ts` + `pagination.ts` 链接解析切面，却分三轮逐次报出。
- Seen 3× (2026-11-03, 2026-11-04).

**构建与真机验证脚本（`scripts/`）直接操作已列入 `.gitignore` 的 `.dev-vault` 与 `.tmp` 沙盒，严禁编写快照回滚还原、硬链接防御或 `assertNoObsidian` 全局进程拦截。**
- 对专用测试沙盒做快照回滚不仅会在 `.tmp/` 堆积备份垃圾文件，还会在验收后把 `.dev-vault` 新构建的插件回滚成旧版本，且因宿主机开着用户正常 Obsidian 而拒绝执行测试。
- 真实翻车证据：`920c1d5` 与 `56dfaba` 中 `scripts/obsidian-safety.mjs`、`scripts/verify-obsidian.mjs` 反复引入快照回滚与全局进程封锁，已在 `9c3ce87` 彻底删除。
- Seen 3× (2026-11-03, 2026-11-04).

**CSS 多列（Multi-column）分页阅读器测量跨列字符位置或执行连续窗口缩放时，必须使用 `range.getClientRects()` 过滤宽高非零的实际字符片段，且 `ResizeObserver` 重排恢复位置时不得用重采样覆盖原锚点。**
- 跨列文本块的 `range.getBoundingClientRect()` 会返回横跨多列的合并外包矩形（`rect.left` 退化为首列左边界）；而重排后立即覆写 `readerPosition` 会导致连续拖拽窗口时阅读位置逐级向页首回退。
- 真实翻车证据：`[Task #13]`（`34b6c6f`）在单栏大字号下将窗口从 `1600×900` 缩至 `1100×700` 时，跨页无空格中文段落从标记 `025–048` 回退至 `013–024`，在 `f36d6b3` 修复。
- Seen 1× (2026-11-04).

## Moved to Guard Tests / Standards

- **禁止同名函数重赋值包装链（`const xBase = x; x = ...`）与 `stopImmediatePropagation()` 截胡死代码** → 已固化为守卫测试 [`tests/boundaries.test.ts`](../tests/boundaries.test.ts)（`source does not retain Base aliases for function wrappers` & `Web reader entry points have one definition and are never reassigned`）。
- **禁止通过 `readFile("src/...")` 抠取源码字符串塞入 `vm.runInContext` 跑假测试** → 已固化为守卫测试 [`tests/boundaries.test.ts`](../tests/boundaries.test.ts)（`tests do not execute extracted source in a VM`）。
- **禁止在 ACP 插件中硬编码读取 `~/.dsh/` 私有配置，禁止在语音运行时调用 `python3 / pip` 或使用纯英文 `Piper / whisper-tiny.en` 模型** → 已固化为守卫测试 [`tests/boundaries.test.ts`](../tests/boundaries.test.ts)（`managed speech uses native multilingual models and ACP never reads dsh private configuration`）。
- **核心包与插件隔离、宿主零泄漏、零系统低劣语音与外部仓库硬编码** → 已固化为守卫测试 [`tests/boundaries.test.ts`](../tests/boundaries.test.ts)。
