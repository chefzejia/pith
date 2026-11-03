import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devVault = resolve(root, ".dev-vault");
const userDataDir = resolve(root, ".tmp/obsidian-user-data");
const obsidianBin = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";

async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Failed to allocate port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolvePort(port));
    });
    srv.on("error", reject);
  });
}

async function pollJson(url: string, timeoutMs = 15_000): Promise<Array<{ id: string; url: string; webSocketDebuggerUrl: string }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const list = (await res.json()) as Array<{ id: string; url: string; webSocketDebuggerUrl: string }>;
        if (list.some(item => item.url.includes("obsidian.md") && item.webSocketDebuggerUrl)) return list;
      }
    } catch {
      // retry until deadline
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for Obsidian CDP endpoint at ${url}`);
}

async function evaluateInPage<T>(wsUrl: string, expression: string): Promise<T> {
  return new Promise((resolveEval, rejectEval) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      rejectEval(new Error("CDP Runtime.evaluate timed out"));
    }, 15_000);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });

    ws.addEventListener("message", event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.error) {
        rejectEval(new Error(JSON.stringify(msg.error)));
        return;
      }
      if (msg.result?.exceptionDetails) {
        rejectEval(new Error(msg.result.exceptionDetails.exception?.description || msg.result.exceptionDetails.text || "CDP evaluation exception"));
        return;
      }
      resolveEval(msg.result?.result?.value as T);
    });

    ws.addEventListener("error", err => {
      clearTimeout(timer);
      rejectEval(err);
    });
  });
}

async function main(): Promise<void> {
  await mkdir(userDataDir, { recursive: true });
  await writeFile(
    resolve(userDataDir, "obsidian.json"),
    JSON.stringify({
      vaults: {
        devvault00000001: {
          path: devVault,
          ts: Date.now(),
          open: true,
        },
      },
    }),
  );

  const port = await findFreePort();
  const child = spawn(obsidianBin, [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`], {
    stdio: "ignore",
  });

  try {
    const targets = await pollJson(`http://127.0.0.1:${port}/json/list`);
    const page = targets.find(t => t.url.includes("obsidian.md") && t.webSocketDebuggerUrl)!;

    const report = await evaluateInPage<{
      ok: boolean;
      error?: string;
      vaultName?: string;
      pluginLoaded?: boolean;
      viewType?: string;
      leftCollapsed?: boolean;
      settingLabels?: string[];
      savedSpeechConfig?: Record<string, string>;
    }>(
      page.webSocketDebuggerUrl,
      `(async () => {
        try {
          const deadline = Date.now() + 12000;
          while (Date.now() < deadline) {
            const app = window.app;
            if (app && app.workspace && app.workspace.layoutReady && app.plugins && app.plugins.manifests && app.plugins.manifests["pith"]) break;
            await new Promise(r => setTimeout(r, 200));
          }
          const app = window.app;
          if (!app) return { ok: false, error: "window.app not found" };
          if (app.plugins.setEnable) await app.plugins.setEnable(true);
          if (!app.plugins.plugins["pith"]) {
            await app.plugins.enablePlugin("pith");
          }
          const plugin = app.plugins.plugins["pith"];
          if (!plugin) return { ok: false, error: "pith plugin instance not loaded" };
          if (!plugin.controller) {
            await plugin.onload();
          }
          await plugin.openView();
          const leaves = app.workspace.getLeavesOfType("pith-reader");
          if (!leaves.length) return { ok: false, error: "pith-reader leaf not mounted" };

          const hostEl = document.createElement("div");
          const tabInstance = (app.setting?.pluginTabs || []).find((t) => t.id === "pith");
          if (tabInstance) {
            tabInstance.containerEl = hostEl;
            tabInstance.display();
          }
          const settingLabels = Array.from(hostEl.querySelectorAll("label")).map(l => l.childNodes[0]?.textContent?.trim() || "");
          await plugin.controller.setSpeechConfig({
            ttsProvider: "openai-compatible-local",
            ttsEndpoint: "http://127.0.0.1:8880/v1/audio/speech",
            ttsModel: "e2e-tts-model",
            ttsVoice: "e2e-voice",
            azureRegion: "",
            asrProvider: "sensevoice-local",
            asrLoopbackUrl: "http://127.0.0.1:8766/v1/audio/transcriptions",
            asrModel: "e2e-asr-model",
          });

          return {
            ok: true,
            vaultName: app.vault.getName(),
            pluginLoaded: true,
            viewType: leaves[0].view.getViewType(),
            leftCollapsed: Boolean(app.workspace.leftSplit?.collapsed),
            settingLabels,
            savedSpeechConfig: plugin.controller.getSpeechConfig(),
          };
        } catch (err) {
          return { ok: false, error: err && err.stack ? err.stack : String(err) };
        }
      })()`,
    );

    if (!report.ok) {
      throw new Error(`Obsidian E2E inner error:\n${report.error}`);
    }

    if (report.vaultName !== ".dev-vault") {
      throw new Error(`Unexpected vault opened: ${report.vaultName}`);
    }
    if (!report.pluginLoaded || report.viewType !== "pith-reader") {
      throw new Error(`Pith view failed E2E check: ${JSON.stringify(report)}`);
    }
    console.log(JSON.stringify({ ok: true, cdpPort: port, ...report }, null, 2));
  } finally {
    child.kill("SIGTERM");
  }
}

await main();
