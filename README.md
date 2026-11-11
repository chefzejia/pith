# Pith

> **/pɪθ/** — *botany: the core tissue of a plant; figuratively: the spinal cord, the essential force.*
>
> **We used all human wisdom to train AI. Pith uses AI's training pipeline to train you.**

**English** | [简体中文](README.zh-CN.md)

Pith is a host-agnostic **Personal Attention & Human Training System** running inside [Obsidian](https://obsidian.md), standalone desktop Web, and Super Agent workbenches (DSH).

In the AI era, the marginal cost of generating content has dropped to near zero while information noise explodes, fracturing fixed human attention bandwidth. As agents evolve into Super Agents, the ultimate bottleneck returns to the human: if you stop evolving — outsourcing thinking to AI or mistaking summaries for mastery (*the fluency illusion*) — your own mental weights never update. Humanity poured its collective wisdom into discovering how to train frontier models; Pith reverse-engineers that training pipeline to train you.

---

## The Human Training Pipeline

Knowledge that never passes through your own forward generation (rollout), error exposure, and feedback never updates your intuition. Pith turns the five stages of model training into a daily loop for human evolution:

| Stage | Model Training | Human Evolution (Theory + Practice) | Pith Mechanism |
| :--- | :--- | :--- | :--- |
| **0. Compute & Base Weights** | Allocate finite compute budget; maintain base model weights | **Attention defense & cognitive baseline**: Block out feed noise, focus on active topics and a 15-minute next step | **Topic Board & Next Step** + **`ME.md` (cognitive baseline)** |
| **1. Pre-training** | Curate high-quality primary corpora to build base representations | **Primary source ingestion**: Reject second-hand summaries. Read original books, papers, code, and podcasts directly | **Reading & Media Stages (`stage-*`)** + **Input Scaffolding & Read-Aloud** |
| **2. SFT** | Expert demonstrations to align reasoning paths | **Tailored decomposition & lesson generation**: An agent grounded in your `ME.md` breaks down causal chains, writes lessons, and orchestrates topic toolkits | **Guide Collaborator (`guide-*`)** |
| **3. Post-training RL** | Model rolls out first → environment returns error signal → update gradient | **Embodied & generative practice**: Remove crutches so you shadow, recall, and explain from memory against immediate error feedback | **In-Place Practice Dojos (`dojo-*`)** |
| **4. Eval & Merge** | Run benchmarks to verify generalization, then merge checkpoint | **Settlement gate & weight consolidation**: Defend against counterexamples and transfer questions; settlement requires your own practice and notes | **Settlement Gate** → Archives the topic and updates `ME.md` |

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
| `npm run test:file -- <files>` | Run selected test files inside the same throwaway `HOME` / `PITH_SPEECH_HOME` sandbox as `npm test` |
| `npm run build:obsidian` | Build Obsidian plugin bundle and sync to `.dev-vault` sandbox |
| `npm run install:obsidian` | Build, then install `main.js`, `styles.css` and `manifest.json` into a real vault's `.obsidian/plugins/pith/` (vault path from the argument, `PITH_OBSIDIAN_VAULT`, or the default vault) |
| `npm run verify:obsidian` | Launch isolated `/Applications/Obsidian.app` (`.dev-vault`) for live CDP E2E verification |
| `npm run web` | Start standalone Web desktop shell |

## Project Structure

- [`src/core/`](src/core/): Zero-dependency domain kernel (`PluginRuntime`, `WorkspaceStore`, `AttentionEngine`, [`HostPort`](src/core/host.ts), and capability contracts in [`seams.ts`](src/core/seams.ts)).
- [`src/plugins/`](src/plugins/): Isolated sibling plugins for presentation stages, practice dojos, standard ACP guide, and speech services, registered in [`src/plugins/all.ts`](src/plugins/all.ts).
- `src/workbench/`: Single shared graphical workbench UI and interaction state machine consumed across every shell (`obsidian`, `web`, `dsh`).
- [`src/shells/`](src/shells/): Thin native host adapters (`obsidian`, `web`, `dsh`, `speech`).
- [`tests/`](tests/): Architecture boundary guards and subsystem verification suites.

## Documentation

- [`docs/PRODUCT.md`](docs/PRODUCT.md): Product positioning, core modules, spatial interaction laws, and domain glossary.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) & [`docs/subsystems/`](docs/subsystems/1-core-store-engine.md): 4-layer unidirectional DAG, subsystem contracts ([`1-core`](docs/subsystems/1-core-store-engine.md) · [`2-stages`](docs/subsystems/2-stages.md) · [`3-dojos`](docs/subsystems/3-dojos.md) · [`4-guide-speech-shells`](docs/subsystems/4-guide-speech-shells.md) · [`5-spatial-ui-and-slots`](docs/subsystems/5-spatial-ui-and-slots.md)), and data ownership.
- [`AGENTS.md`](AGENTS.md): Agent collaboration boundaries, verification commands, and routing.
