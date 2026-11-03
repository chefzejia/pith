# Pith · 项目状态总交接单（HANDOFF · 供新 Brain 会话无缝接手）

> **最后更新**：2026-11-03（Wave 1 ~ Wave 7 全部合拢封存）
> **仓库根目录**：`/Users/zejiawu/Projects/Project-Atlas/labs/pith`
> **多 Agent 协同模式**：
> - **宏观架构与决策（Brain）**：在 `/Users/zejiawu/Projects/Project-Atlas/labs/pith` 下启动 DSH 会话，负责产品/架构讨论、冻结 `src/core/` 接口、更新本 `docs/HANDOFF.md` 并提交 Git；
> - **执行与真机 CUA 验收（Worker & Tester）**：在 ChatGPT App (Codex Desktop) 的 `pith` 常驻总控线程中开启了原生定期 Heartbeat 自动监听本文件的 Git 提交，自动派生并监督 Worker 与 CUA Tester 完成编码与 `.dev-vault` 真机验收。

---

## 一、 当前已落地的完整基线状态（126 / 126 测试全绿）

Pith 已从零完成 **Wave 1 至 Wave 7** 的架构构建、母本资产迁移与空间交互重构，所有代码已独立自包含（`package.json` 自带 `typescript` / `esbuild` 开发工具链，运行时零第三方 npm 依赖）：

1. **第一层：绝对内核（`src/core/` · 100% 稳定）**
   - `pluginrt/`：同步注册、同名服务栈（Service Stacking 无缝回退）、四层 `compose()` 传递保活（`InUse`）、逆序 `onDispose` 与 `ViewKernel` 错误隔离边界；
   - `store/`：纯 Markdown 事实源 `DefaultWorkspaceStore`（`ME.md`、`topics/`、`materials/`）+ `MutationQueue` 并发串行锁；
   - `engine/`：去 Session 化 `DefaultAttentionEngine` + `_cache/effects.json` 按 `(kind, key)` 自动合并去重队列；
   - `host.ts` & `seams.ts`：窄接口 `HostPort`（含 `storage`, `http`, `secrets`, `process`）与全部能力接缝定义。

2. **第二层：六大内置插件（`src/plugins/` · 互不耦合）**
   - `stage-reader`：支持 Markdown（含 GFM 表格与围栏/Callout 交互式教学块 `teachingBlocks`）、完整 EPUB（含内嵌图片 Base64 重写、SVG 消毒、章节样式范围限定与目录定位）、CBZ 漫画自然序解析、单图、轻量 PDF 文本与页码提取、上下文锚点重定位（`matchTextAnchor`）、霞鹜文楷 `LXGW WenKai` 字库注入（`fontData.ts`），以及跨设备连续几何自适应算法 `resolveResponsiveLayout`；
   - `stage-timeline`：SRT / WebVTT / 带时间戳文稿解析、A-B 循环切片（`sliceLoopRange`）与时间轴视图；
   - `dojo-shadowing`：外语 4 阶渐进跟读脚手架与 Unicode 词级 LCS 漏词诊断；
   - `dojo-feynman`：深度阅读 4 阶费曼复述与混合语言核心概念覆盖诊断；
   - `speech-service`：只读正文过滤（`filterProseOnly` 跳过代码块/表格/图片）、严选高品质神经网络 TTS/ASR 预设（`kokoro-local` / `openai-tts` / `azure-neural` & `whisper-local` / `sensevoice-local` / `openai-whisper`）、下一句并发预取队列 `PrefetchSpeechQueue`，**全仓静态守卫永久封杀系统低劣语音 `speechSynthesis` 且严格 Fail-Closed**；
   - `guide-acp`：零 Magpie 依赖自动扫描本机 `dsh --profile acp`、`claude-agent-acp`、`codex-acp`（30s TTL 缓存），通过 stdio JSON-RPC 建立只读沙箱会话（`DSH_PERMISSION_MODE=read-only` + `sandbox-exec`），内置 7 个受控工作区工具（含强制检验笔记与总结摘要的**毕业门控 `pith_settle_topic`** 与防 SSRF 外部网页摄取 `pith_ingest_external`）。

3. **第三层：三大原生宿主壳（`src/shells/`）与 Wave 6~7 空间设计落地**
   - `shells/obsidian`（一键构建 `dist/obsidian/{main.js, manifest.json, styles.css}`）：
     - 默认将数据收纳于 Vault 顶层 **`Pith/`** 目录（绝不污染根目录），具备符号链接逃逸拦截与 `wx` 原子排他创建保护；
     - 打开 Pith 自动折叠 Obsidian 原生左侧文件树（`leftSplit.collapse()`）；
     - 44px 极简顶栏 + **单一弹性工具胶囊槽**（`toolkitSlot.ts`：0 工具显示 `+`，1 工具显示 `✦ 费曼复述`，多工具聚合为 `✦ 影子跟读 · 2 ▾`）+ **`[Aa]` 精致排版弹出气泡**；
     - 进入阅读页默认收起右侧向导栏让位主视觉，按课题记忆用户开关偏好；
     - **实心停靠播客甲板（`.pith-media-deck` + `mediaAssets.ts`）**：检测到材料含音频资产（`.mp3/.m4a/.wav` 等）或开启伴读时在底部实心停靠（零遮挡正文），支持进度拖动、`±15s`、倍速、与字幕时间点点击联动；
     - 实时响应 `resolveResponsiveLayout`：支持手机竖屏 `bottom-sheet`、窄横屏 `overlay-drawer`、折叠屏展开“左书右师” `split-right`、以及开关侧栏时单/双栏自动平滑升降级。
   - `shells/web`：与 Obsidian 壳 100% 视觉和交互同步，支持 `/fonts/lxgw-wenkai.woff2` 与 `/api/materials/:id/raw` 字节范围（Range）音频流服务。
   - `shells/dsh`：暴露完整 DSH 工具包绑定。

---

## 二、 下一阶段待探索与推进方向（供新 Brain 与用户决策）

新会话接手后，可围绕以下高价值方向与用户讨论并派发后续任务包：

1. **PC 端离线播客/伴读音频生成管线（对接本机 `ganfan-audio` 的 `IndexTTS-2.5`）**：
   - 目前前端的 `.pith-media-deck`（检测到材料目录下有音频文件即自动弹出实心播客控制条）已经就绪；
   - 下一步可打通「PC 端一键/由向导 Agent 触发离线合成」：调用本机 `/Users/zejiawu/Projects/Project-Atlas/ganfan-audio/bin/tts-clone`（`IndexTTS-2.5`，单次运行完即退出释放内存，**严禁调用废弃的 `Qwen3-TTS`**）或轻量 `Kokoro-82M`，将当前文章或向导生成的双人/单人讲义离线渲染为 `.mp3/.wav` + `.vtt` 字幕写入 `Pith/materials/<id>/files/`，实现 **「Mac 离线高保真合成 $\rightarrow$ Obsidian 跨端同步 $\rightarrow$ 手机端零算力打开即出播客条边听边看」**。
2. **真机深度打磨与复杂电子书/PDF 阅读细节补强**：
   - 在固定测试库 `/Users/zejiawu/Projects/Project-Atlas/labs/pith/.dev-vault` 中用真实复杂版式 `.epub` / `.pdf` 持续体验，对照母本 `/Users/zejiawu/Projects/Project-Atlas/labs/ganfan-garden/src/material/render/`（如宽表查看器、阅读进度自动写回 `material.md` 的防抖会话、PDF.js 按需页面位图渲染等）按需做精细增强。
3. **日常 Dogfooding 部署或独立桌面/移动容器封装**：
   - 待 `.dev-vault` 验收满意后，在用户明确授权下编写受控发布脚本安装至真实使用环境，或评估 Tauri / Capacitor 独立壳封装。
