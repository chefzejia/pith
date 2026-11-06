# Pith

> **/pɪθ/** — *botany: the core tissue of a plant; figuratively: the spinal cord, the essential force.*
>
> **We used all human wisdom to train AI. Pith uses AI's training pipeline to train you.**

**English** | [简体中文](README.zh-CN.md)

Pith is a host-agnostic **Personal Attention & Human Training System** running inside [Obsidian](https://obsidian.md), standalone desktop Web, and Super Agent workbenches (DSH).

---

## Why Pith

In the AI era, the marginal cost of generating content has dropped to near zero, while information noise and anxiety bait explode exponentially. The closer you work to the AI frontier, the more your attention is fractured across tabs, projects, and feeds — yet **human biological bandwidth remains fixed**.

Meanwhile, as agents evolve into Super Agents, **the ultimate bottleneck returns to the human**: your taste, your judgment, the depth of the questions you ask, and your ability to spot where an AI is hallucinating. If you stop evolving — outsourcing every problem to AI like a wishing well, or mistaking AI summaries for real mastery (*the fluency illusion*) — your own "model parameters" never update. A human who stops growing cannot lead stronger agents; they become subservient to silicon intelligence.

**Humanity poured its collective wisdom into discovering how to train frontier models. Pith reverse-engineers that training pipeline to train you.**

---

## The Human Training Pipeline

Knowledge that never passes through your own forward generation (rollout), error exposure, and feedback never updates your intuition. Pith engineers the five stages of model training into a daily loop for human evolution:

| Stage | Model Training | Human Evolution (Theory + Practice) | Pith Implementation |
| :--- | :--- | :--- | :--- |
| **0. Compute & Base Weights** | Allocate finite compute budget; maintain current model weights | **Attention defense & cognitive baseline**: Attention is your only compute. Block out feed noise, focus on a few active topics and a 15-minute next step | **Attention Compass** + **`ME.md` (cognitive baseline snapshot)** |
| **1. Pre-training** | Curate high-quality primary corpora to build base representations | **Primary source ingestion**: Reject neutered second-hand summaries. Read original books, papers, repos, and podcasts directly | **Stage (`stage-reader` & `stage-timeline`)** + **Interline Bilingual warmup** + **Kokoro neural read-aloud** |
| **2. SFT** | Expert demonstrations to align reasoning paths | **Tailored decomposition & demonstration**: When hitting a wall, an agent grounded in your `ME.md` breaks down causal chains and writes tailored lessons | **ACP Guide (`guide-acp`)**: Connects to local `dsh` / `claude` / `codex` via standard ACP and orchestrates toolkits |
| **3. Post-training RL** | Model rolls out first → environment returns error signal → update gradient | **Embodied practice with progressive scaffolding**: Reading alone doesn't update human weights. Speak, shadow, and explain from memory to expose blind spots | **Dojo (`dojo-feynman` & `dojo-shadowing`)**: `listen-decompose` → `guided-follow` → `scaffold-cloze` → `blind-produce` |
| **4. Eval & Merge** | Run benchmarks to verify generalization, then merge checkpoint | **Settlement gate & weight consolidation**: Close the book and explain it clearly. Settlement is blocked without your own practice and notes | **`pith_settle_topic` (hard gate)** → Settles the topic and updates `ME.md` |

---

## Three Scenarios

### 1. The 15-Minute Gap Between Agent Runs
Claude Code, Codex, or DSH is running tests in the background. Spending that wait time on social feeds only fragments your attention. Open Pith: the Attention Compass gives you a concrete 15-minute `nextAction` on an active `Topic` to run an incremental training step on your own mind.

### 2. Pre-training & SFT on Primary Sources
Drop an EPUB, PDF, or podcast into your workspace. Read in a distraction-free `1 / 2 / 3`-column paginated stage; lower startup friction on dense foreign texts with sliding-window **Interline Bilingual** subtitles or **Kokoro neural read-aloud**; highlight a tough passage to ask your local ACP Guide, grounded in your `ME.md` profile.

### 3. Embodied Post-Training RL (From "I Read It" to "I Can Explain It Cold")
Language models live purely in text; human mastery requires embodied forward generation. Based on your topic's intent, the Guide dynamically injects **Feynman Recall** or **Shadowing** dojos into the top bar, walking you through 4 progressive stages (`listen-decompose` → `guided-follow` → `scaffold-cloze` → `blind-produce`) to diagnose missed concepts and pronunciation blind spots, recording evidence directly to your ledger.

---

## Architecture & Engineering Principles

1. **Markdown-as-Weights**
   Every cognitive asset — your learner baseline [`ME.md`](src/core/types.ts), active topics `topics/topic-<id>/topic.md`, and read-only primary materials `materials/material-<id>/` — lives 100% as local plain-text Markdown. Zero proprietary cloud lock-in, git-diffable, and directly readable by any agent. `_cache/` holds disposable derived artifacts that rebuild on demand.
2. **Concentric 3-Layer DAG (Zero Host Leakage)**
   Statically enforced on every test run by [`tests/boundaries.test.ts`](tests/boundaries.test.ts):
   - [`src/core/`](src/core/): Zero-dependency domain kernel (`PluginRuntime`, `WorkspaceStore`, `AttentionEngine`, [`HostPort`](src/core/host.ts), and capability contracts in [`seams.ts`](src/core/seams.ts)).
   - [`src/plugins/`](src/plugins/): Isolated sibling plugins for stages (`stage-reader`, `stage-timeline`), 4-stage dojos (`dojo-interline`, `dojo-shadowing`, `dojo-feynman`), standard ACP guide (`guide-acp`), and neural speech (`speech-service`), gathered only in [`src/plugins/all.ts`](src/plugins/all.ts).
   - [`src/shells/`](src/shells/): Polymorphic native host adapters (`obsidian`, `web`, `dsh`) and the on-demand local speech gateway ([`speechRuntime.ts`](src/shells/speechRuntime.ts)).
3. **Standard ACP & Zero-Python Native Speech**
   - **ACP Guide Discovery**: Drives local agents via standard JSON-RPC stdio, dynamically negotiating model trees and reasoning effort without hardcoding private agent config files.
   - **On-Demand Neural Speech**: Runs native `sherpa-onnx` + `Kokoro-82M v1.1-zh` (TTS) and `SenseVoice` (ASR) outside the Vault, automatically exiting after 180s of idle time to free memory — never falling back to robotic OS `speechSynthesis`.

---

## Quick Start

```bash
npm install
npm run web                # Launch standalone Web desktop shell (http://127.0.0.1:4173)
npm run build:obsidian     # Build dist/obsidian/ and sync to .dev-vault/.obsidian/plugins/pith/
```

## Commands

| Command | Purpose |
| :--- | :--- |
| `npm run typecheck` | Full-repo TypeScript static typecheck |
| `npm test` | Run unit tests and architecture boundary guards ([`tests/boundaries.test.ts`](tests/boundaries.test.ts)) |
| `npm run build:obsidian` | Build Obsidian plugin bundle and sync to `.dev-vault` sandbox |
| `npm run verify:obsidian` | Launch isolated `/Applications/Obsidian.app` (`.dev-vault`) for live CDP E2E verification |
| `npm run web` | Start standalone Web desktop shell |

## Documentation

- [`docs/PRODUCT.md`](docs/PRODUCT.md): Product philosophy (Human Training Pipeline), core modules, spatial UI laws, and domain glossary.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) & [`docs/subsystems/`](docs/subsystems/1-core-store-engine.md): 3-layer unidirectional DAG, subsystem contracts ([`1-core`](docs/subsystems/1-core-store-engine.md) · [`2-stages`](docs/subsystems/2-stages.md) · [`3-dojos`](docs/subsystems/3-dojos.md) · [`4-guide-speech-shells`](docs/subsystems/4-guide-speech-shells.md)), data ownership, and key architectural decisions.
- [`AGENTS.md`](AGENTS.md): Agent collaboration boundaries, verification commands, and on-demand routing.
