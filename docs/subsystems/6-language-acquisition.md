# Pith · 语言习得子系统（Subsystem: Language Acquisition）

> **目标**：构建一个基于认知科学的、闭环的、带有口音感知反馈的语言习得引擎。
> **核心假设**：口音习得是「听觉分辨」与「肌肉动力学」的结合，非纯粹的语义理解。

---

## 1. 认知模型（The Acquisition Loop）

Pith 的语言习得遵循「对比、模仿、修正」三阶段循环：

### 1.1 对比阶段（Discrimination）
*   **目标**：提升用户对口音细节（音素、韵律、重音）的敏感度。
*   **实现**：向导 (Guide) 播放目标音频，系统实时生成语谱图 (Spectrogram) 与韵律曲线 (Prosody Curve)。

### 1.2 模仿阶段（Articulation）
*   **目标**：肌肉动力学模拟。
*   **实现**：结合发音部位的可视化辅助（如舌位图、唇形图），提供生理学上的发音指引。

### 1.3 修正阶段（Feedback Loop）
*   **目标**：ASR 实时校准。
*   **实现**：用户跟读后，系统对比用户与目标音的「差异热力图」，精准定位发音偏差。

---

## 2. 系统架构（Engine & Integration）

此子系统深度集成于 `src/plugins/speech-service` 与 `src/plugins/toolkit-shadowing`。

### 2.1 本地化 Pipeline (Local Engine)
为保证低延迟反馈，本系统强制采用端侧模型：
*   **ASR**: 部署 `Whisper.cpp`，实现高精度 Word-level/Phoneme-level 时间戳对齐。
*   **TTS**: 部署 `Piper` 或 `VITS` 变体，支持口音风格 (Style) 的本地热切换。

### 2.2 协议层接口
系统需要扩展 `SpeechRuntime` 协议，支持：
```typescript
interface AccentAcquisitionRequest {
  targetAudio: string;        // 目标口音音频流
  phonemeAlignment: boolean;  // 开启音素级对齐
  articulationGuide: boolean; // 开启肌肉部位辅助
}
```

---

## 3. 核心功能场景

### 3.1 语境跟读（Contextual Shadowing）
用户阅读课题材料时，开启口音训练模式。向导在阅读特定句子时，通过提示语引导用户进行影子跟读，无需跳出阅读流。

### 3.2 偏差热力图（Variance Heatmap）
界面显示用户发音的语谱图叠加在目标音频上，偏差区域自动标记为 `contradiction-zone`，向导会针对该区域进行追问与复练。

### 3.3 肌肉动作可视化（Articulation UI）
集成轻量级口腔渲染组件，实时显示目标发音时舌尖与上齿龈的接触状态，帮助用户建立肌肉记忆。

---

## 4. 技术实施路线图

1.  **阶段一（基建）**：完成 ASR/TTS 本地化部署与协议适配。
2.  **阶段二（对比）**：实现语谱图可视化对比与实时反馈接口。
3.  **阶段三（动力学）**：实现口腔解剖部位的可视化指引。
4.  **阶段四（闭环）**：将上述能力封装为 `pith_shadowing_feedback` 工具，集成至 ACP，实现自动化评测。

---

## 5. 设计约束

*   **本地化第一**：严禁将原始语音数据回传云端 API，仅限本地模型推理。
*   **即时性**：反馈延迟需控制在 100ms 以内。
*   **无感嵌入**：语言习得应作为阅读课题的附属增益，而非独立的“学习机”界面。
