import { execFile, spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import { migrateLegacySpeech, switchSpeechMode, validSpeechProfiles } from "../src/shells/speechSettings.ts";
// @ts-expect-error JavaScript helper has no declaration file.
import { snapshotFiles } from "./obsidian-safety.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devVault = resolve(root, ".dev-vault");
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

export function isOwnedProcess(pid: number, owner: number, parents: Map<number, number>): boolean {
  const seen = new Set<number>();
  while (pid > 0 && !seen.has(pid)) { if (pid === owner) return true; seen.add(pid); pid = parents.get(pid) ?? 0; }
  return false;
}

export async function stopOwnedChild(child: ChildProcess, exited: Promise<void>, timeoutMs = 15_000): Promise<void> {
  if (!child.pid) return;
  if (child.exitCode === null && child.signalCode === null && child.pid) child.kill("SIGTERM");
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Owned Obsidian process did not exit")), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function ownedPort(port: number, owner: number): Promise<boolean> {
  let listeners: string;
  try { listeners = (await promisify(execFile)("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])).stdout; }
  catch (error) { if ((error as { code?: number }).code === 1) return false; throw error; }
  const ids = listeners.trim().split(/\s+/).map(Number);
  const processes = await promisify(execFile)("/bin/ps", ["-axo", "pid=,ppid="]);
  const parents = new Map<number, number>();
  for (const line of processes.stdout.split("\n")) { const match = line.trim().match(/^(\d+)\s+(\d+)$/); if (match) parents.set(Number(match[1]), Number(match[2])); }
  if (!ids.length || ids.some(pid => !Number.isInteger(pid) || !isOwnedProcess(pid, owner, parents))) throw new Error("CDP port belongs to an unowned process");
  return true;
}

async function pollJson(url: string, checkOwner: () => Promise<boolean>, timeoutMs = 15_000): Promise<Array<{ id: string; url: string; webSocketDebuggerUrl: string }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await checkOwner()) { await new Promise(r => setTimeout(r, 250)); continue; }
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

export function hasObsidianProcess(output: string): boolean {
  return output.split("\n").some(line => /\/Obsidian\.app\/Contents\/MacOS\/Obsidian(?:\s|$)/.test(line));
}

async function assertNoObsidian(): Promise<void> {
  const processes = await promisify(execFile)("/bin/ps", ["-axo", "pid=,command="]);
  if (hasObsidianProcess(processes.stdout)) throw new Error("An Obsidian process is already running; refusing to attach or launch");
}

async function assertOwnedObsidian(owner: number): Promise<void> {
  const processes = await promisify(execFile)("/bin/ps", ["-axo", "pid=,ppid=,command="]);
  const parents = new Map<number, number>(); const mains: number[] = [];
  for (const line of processes.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line); if (!match) continue;
    const pid = Number(match[1]); parents.set(pid, Number(match[2]));
    if (/\/Obsidian\.app\/Contents\/MacOS\/Obsidian(?:\s|$)/.test(match[3]!)) mains.push(pid);
  }
  if (!mains.includes(owner) || mains.some(pid => !isOwnedProcess(pid, owner, parents))) throw new Error("Unowned or missing Obsidian process; refusing to continue");
}

async function main(): Promise<void> {
  const vaultInfo = await lstat(devVault);
  if (!vaultInfo.isDirectory() || vaultInfo.isSymbolicLink()) throw new Error(".dev-vault must be an existing directory");
  await assertNoObsidian();
  for (const path of ["Pith", "Pith/topics", "Pith/materials", "Pith/_cache"]) {
    const info = await lstat(resolve(devVault, path)); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected existing directory: ${path}`);
  }
  const profile = await lstat(resolve(devVault, "Pith/ME.md")); if (!profile.isFile() || profile.isSymbolicLink()) throw new Error("Expected existing Pith/ME.md");
  const tmp = resolve(root, ".tmp"); await mkdir(tmp, { recursive: true }); const tmpInfo = await lstat(tmp); if (!tmpInfo.isDirectory() || tmpInfo.isSymbolicLink()) throw new Error("Invalid .tmp directory");
  const runDir = await mkdtemp(resolve(tmp, "pith-obsidian-e2e-"));
  const userDataDir = resolve(runDir, "profile");
  const settingsPath = "Pith/_cache/web-settings.json";
  const configPaths = [settingsPath, ".obsidian/plugins/pith/data.json", ".obsidian/community-plugins.json", ".obsidian/workspace.json", ".obsidian/app.json", ".obsidian/appearance.json", ".obsidian/core-plugins.json", ".obsidian/graph.json", ".obsidian/hotkeys.json"];
  console.error(`Obsidian E2E backup: ${resolve(runDir, "backup")}`);
  const snapshot = await snapshotFiles(devVault, configPaths, resolve(runDir, "backup"));
  let pluginData: { workspacePath?: unknown } = {};
  try { pluginData = JSON.parse(await readFile(resolve(devVault, ".obsidian/plugins/pith/data.json"), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!pluginData || (pluginData.workspacePath !== undefined && pluginData.workspacePath !== "Pith")) throw new Error(`Unsupported workspace path; backup: ${runDir}`);
  try { const enabled: unknown = JSON.parse(await readFile(resolve(devVault, ".obsidian/community-plugins.json"), "utf8")); if (!Array.isArray(enabled) || enabled.some(id => id !== "pith")) throw new Error("Other community plugins are enabled"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(await readFile(resolve(devVault, settingsPath), "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) throw new Error("Invalid saved settings");
  if (saved.speech !== undefined && (!saved.speech || typeof saved.speech !== "object" || Array.isArray(saved.speech) || Object.values(saved.speech).some(value => typeof value !== "string"))) throw new Error("Invalid speech settings");
  if (saved.speechProfiles !== undefined && !validSpeechProfiles(saved.speechProfiles)) throw new Error("Invalid speech profiles");
  if (saved.speechSettingsVersion !== undefined && saved.speechSettingsVersion !== 1) throw new Error("Invalid speech settings version");
  const originalSpeech = migrateLegacySpeech((saved.speech ?? {}) as Record<string, string>, saved.speechSettingsVersion, saved.speechProfiles);
  const switched = switchSpeechMode(originalSpeech, saved.speechProfiles ?? {}, "local");
  const speech = { ...switched.speech, ttsEndpoint: "http://127.0.0.1:8880/v1/audio/speech", ttsModel: "e2e-tts-model", ttsVoice: "e2e-voice", asrLoopbackUrl: "http://127.0.0.1:8766/v1/audio/transcriptions", asrModel: "e2e-asr-model" };
  const agent = { agentId: saved.agentId ?? "", model: saved.model ?? "", effort: saved.effort ?? "", persona: saved.persona ?? "sanctuary" };
  const intermediate = Object.assign({}, { preset: "all", persona: "sanctuary", plugins: {}, agentId: "", model: "", effort: "" }, saved, agent);
  let step: Record<string, string> = switched.speech;
  const steps = [step];
  for (const key of ["ttsEndpoint", "ttsModel", "ttsVoice", "asrLoopbackUrl", "asrModel"] as const) { step = { ...step, [key]: speech[key] }; steps.push(step); }
  for (const agentId of [String(agent.agentId), "dsh", "claude", "codex"]) {
    await snapshot.expect(settingsPath, `${JSON.stringify({ ...intermediate, agentId }, null, 2)}\n`);
    for (const value of steps) await snapshot.expect(settingsPath, `${JSON.stringify({ ...intermediate, agentId, speech: value, speechProfiles: switched.profiles, speechSettingsVersion: 1 }, null, 2)}\n`);
  }
  for (const path of configPaths) await snapshot.assertOriginal(path);
  await mkdir(userDataDir);
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
  const child = spawn(obsidianBin, [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, "--use-mock-keychain", "--password-store=basic"], {
    stdio: "ignore",
  });
  const exited = new Promise<void>((resolveExit, rejectExit) => { child.once("exit", () => resolveExit()); child.once("error", rejectExit); });
  void exited.catch(() => {});
  let report: Record<string, unknown> | undefined;
  let completed = false;
  let failure: unknown;

  try {
    if (!child.pid) throw new Error("Obsidian did not spawn");
    const owned = async () => { if (child.exitCode !== null || child.signalCode !== null || !child.pid) throw new Error("Owned Obsidian process exited"); await assertOwnedObsidian(child.pid); return ownedPort(port, child.pid); };
    const targets = await pollJson(`http://127.0.0.1:${port}/json/list`, owned);
    const page = targets.find(t => t.url.includes("obsidian.md") && t.webSocketDebuggerUrl)!;

    if (child.exitCode !== null || child.signalCode !== null || !child.pid) throw new Error("Owned Obsidian process exited before CDP was ready");
    if (!await owned()) throw new Error("CDP listener disappeared");
    let monitorBusy = false;
    let rejectMonitor!: (error: unknown) => void;
    const monitor = new Promise<never>((_, reject) => { rejectMonitor = reject; });
    const interval = setInterval(() => { if (monitorBusy || !child.pid) return; monitorBusy = true; void assertOwnedObsidian(child.pid).catch(error => { child.kill("SIGTERM"); rejectMonitor(error); }).finally(() => { monitorBusy = false; }); }, 250);
    try { report = await Promise.race([monitor, evaluateInPage<{
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
          if (app.vault.adapter.getBasePath() !== ${JSON.stringify(devVault)}) return { ok: false, error: "unexpected vault path" };
          if (app.plugins.setEnable) await app.plugins.setEnable(true);
          if (!app.plugins.plugins["pith"]) {
            await app.plugins.enablePlugin("pith");
          }
          const plugin = app.plugins.plugins["pith"];
          if (!plugin) return { ok: false, error: "pith plugin instance not loaded" };
          if (!plugin.controller) return { ok: false, error: "pith controller unavailable" };
          await plugin.openView();
          const leaves = app.workspace.getLeavesOfType("pith-reader");
          if (!leaves.length) return { ok: false, error: "pith-reader leaf not mounted" };

          app.setting.open(); app.setting.openTabById("pith");
          const tabInstance = (app.setting.pluginTabs || []).find((t) => t.id === "pith");
          const hostEl = tabInstance && tabInstance.containerEl;
          if (!hostEl || !hostEl.isConnected) throw new Error("Pith settings UI is not mounted");
          const settingLabels = Array.from(hostEl.querySelectorAll("label")).map(l => l.childNodes[0]?.textContent?.trim() || "");
          const fields = ${JSON.stringify({ "语音服务模式": "local", "TTS 端点 URL": speech.ttsEndpoint, "TTS 模型": speech.ttsModel, "音色": speech.ttsVoice, "ASR 端点 URL": speech.asrLoopbackUrl, "ASR 模型": speech.asrModel })};
          for (const [label, value] of Object.entries(fields)) {
            const row = Array.from(hostEl.querySelectorAll("label")).find(l => l.firstChild?.textContent === label);
            const field = row && row.querySelector("input,select");
            if (!field) throw new Error("Missing setting: " + label);
            field.value = value; field.dispatchEvent(new Event("change", { bubbles: true }));
          }
          const statuses = hostEl.querySelectorAll('[role="status"]'), status = statuses[statuses.length - 1];
          await new Promise((resolve, reject) => { const expected = ${JSON.stringify(speech)}; const observer = new MutationObserver(() => { if (Object.entries(expected).every(([key, value]) => plugin.controller.getSpeechConfig()[key] === value)) { observer.disconnect(); clearTimeout(timer); resolve(); } else if (status.textContent && status.textContent !== "设置已保存" && status.textContent !== "未发现可用 Agent") { observer.disconnect(); clearTimeout(timer); reject(new Error(status.textContent)); } }); const timer = setTimeout(() => { observer.disconnect(); reject(new Error("Auto-save timed out")); }, 10000); observer.observe(status, { childList: true, characterData: true, subtree: true }); });

          const access = plugin.secretAccess, originalGetSecret = access.getSecret; let secretReads = 0;
          access.getSecret = (...args) => { secretReads++; return originalGetSecret.apply(access, args); };
          try {
            await plugin.controller.runtime.getService("speech.tts").checkHealth();
            await plugin.controller.runtime.getService("speech.asr").checkHealth();
          } finally { access.getSecret = originalGetSecret; }
          if (secretReads !== 0) throw new Error("Local speech accessed secret storage");

          return {
            ok: true,
            vaultName: app.vault.getName(),
            pluginLoaded: true,
            viewType: leaves[0].view.getViewType(),
            leftCollapsed: Boolean(app.workspace.leftSplit?.collapsed),
            settingLabels,
            savedSpeechConfig: plugin.controller.getSpeechConfig(),
            localSecretReads: secretReads,
          };
        } catch (err) {
          return { ok: false, error: err && err.stack ? err.stack : String(err) };
        }
      })()`,
    )]); } finally { clearInterval(interval); }

    if (!report.ok) {
      throw new Error(`Obsidian E2E inner error:\n${report.error}`);
    }

    if (report.vaultName !== ".dev-vault") {
      throw new Error(`Unexpected vault opened: ${report.vaultName}`);
    }
    if (!report.pluginLoaded || report.viewType !== "pith-reader") {
      throw new Error(`Pith view failed E2E check: ${JSON.stringify(report)}`);
    }
    const persisted = JSON.parse(await readFile(resolve(devVault, settingsPath), "utf8"));
    if (!isDeepStrictEqual(persisted.speech, speech)) throw new Error("Saved speech settings do not match the form");
    if (!isDeepStrictEqual(persisted.speechProfiles, switched.profiles)) throw new Error("Saved speech profiles do not match the mode change");
    completed = true;
  } catch (error) {
    failure = error;
  } finally {
    try { await stopOwnedChild(child, exited); }
    catch (error) { throw new AggregateError(failure ? [failure, error] : [error], `Cannot confirm child exit; backups preserved at ${runDir}`); }
    try {
      for (const path of configPaths.filter(path => path !== settingsPath)) if (completed || path === ".obsidian/workspace.json") await snapshot.expectCurrent(path);
      await snapshot.restore();
    } catch (error) { throw new AggregateError(failure ? [failure, error] : [error], `Restore failed; backups preserved at ${runDir}`); }
  }
  if (failure) throw failure;
  console.log(JSON.stringify({ ok: true, cdpPort: port, ...report, backup: resolve(runDir, "backup") }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--preflight") await assertNoObsidian();
  else await main();
}
