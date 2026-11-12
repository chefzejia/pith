import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { switchSpeechMode } from "../src/shells/speech/speechSettings.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devVault = resolve(root, ".dev-vault");
const obsidianBin = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";

export async function startSpeechStub(): Promise<{ base: string; requests: string[]; close: () => Promise<void> }> {
  const requests: string[] = [];
  const server = createHttpServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === "GET" && (request.url === "/health" || request.url === "/asr/health")) { response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("Speech stub has no TCP address"); }
  return { base: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())) };
}

export function speechVerificationFixture(base: string) {
  const speech = { ttsProvider: "kokoro-local", asrProvider: "whisper-local", ttsEndpoint: `${base}/v1/audio/speech`, ttsModel: "e2e-tts-model", ttsVoice: "e2e-voice", asrLoopbackUrl: `${base}/asr` };
  const initial = { preset: "all", persona: "sanctuary", plugins: {}, speech: { ttsProvider: "openai-tts", asrProvider: "openai-whisper" }, speechProfiles: { local: speech }, speechSettingsVersion: 1, agentId: "", agentConfigured: true };
  return { initial, expected: switchSpeechMode(initial.speech, initial.speechProfiles, "local") };
}

export function verifySavedSpeech(persisted: { speech?: unknown; speechProfiles?: unknown; speechSettingsVersion?: unknown }, expected: ReturnType<typeof speechVerificationFixture>["expected"]): void {
  if (!isDeepStrictEqual(persisted.speech, expected.speech)) throw new Error("Saved speech settings do not match the mode change");
  if (!isDeepStrictEqual(persisted.speechProfiles, expected.profiles)) throw new Error("Saved speech profiles do not match the mode change");
  if (persisted.speechSettingsVersion !== 1) throw new Error("Saved speech settings version is not 1");
}

export function isolatedLaunchArgs(userDataDir: string, port: number): string[] {
  return [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${port}`, "--use-mock-keychain", "--password-store=basic"];
}

export function isolatedVaultRegistry(timestamp: number): object {
  return { updateDisabled: true, vaults: { devvault00000001: { path: devVault, ts: timestamp } } };
}

export async function prepareIsolatedVault(vault: string, build: string): Promise<{ configDir: string; workspacePath: string }> {
  const info = await lstat(vault);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(".dev-vault must be an existing directory");
  const config = await mkdtemp(resolve(vault, ".pith-e2e-"));
  const workspace = await mkdtemp(resolve(vault, "Pith-e2e-"));
  const plugin = resolve(config, "plugins/pith");
  await mkdir(plugin, { recursive: true });
  for (const name of ["main.js", "manifest.json", "styles.css"]) await copyFile(resolve(build, name), resolve(plugin, name));
  await writeFile(resolve(plugin, "data.json"), JSON.stringify({ workspacePath: basename(workspace) }), { flag: "wx" });
  await writeFile(resolve(config, "community-plugins.json"), JSON.stringify(["pith"]), { flag: "wx" });
  return { configDir: basename(config), workspacePath: basename(workspace) };
}

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

export async function stopOwnedChild(child: ChildProcess, exited: Promise<void>, timeoutMs = 15_000): Promise<void> {
  if (!child.pid) return;
  if (child.exitCode === null && child.signalCode === null && child.pid) child.kill("SIGTERM");
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([exited, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Owned Obsidian process did not exit")), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

async function pollJson(url: string, child: ChildProcess, matches: (url: string) => boolean, timeoutMs = 15_000): Promise<Array<{ id: string; url: string; webSocketDebuggerUrl: string }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Obsidian process exited");
    try {
      const res = await fetch(url);
      if (res.ok) {
        const list = (await res.json()) as Array<{ id: string; url: string; webSocketDebuggerUrl: string }>;
        if (list.some(item => matches(item.url) && item.webSocketDebuggerUrl)) return list;
      }
    } catch {
      // retry until deadline
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for Obsidian CDP endpoint at ${url}`);
}

async function cdpCommand<T>(wsUrl: string, method: string, params: Record<string, unknown>): Promise<T> {
  return new Promise((resolveEval, rejectEval) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      rejectEval(new Error(`CDP ${method} timed out`));
    }, 15_000);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method,
          params,
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
      resolveEval(msg.result as T);
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      rejectEval(new Error(`CDP WebSocket connection failed: ${wsUrl}`));
    });
  });
}

async function evaluateInPage<T>(wsUrl: string, expression: string): Promise<T> {
  const result = await cdpCommand<{ result: { value: T } }>(wsUrl, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  return result.result.value;
}

async function screenshot(wsUrl: string, path: string): Promise<void> {
  const result = await cdpCommand<{ data: string }>(wsUrl, "Page.captureScreenshot", { format: "png" });
  await writeFile(path, Buffer.from(result.data, "base64"));
}

async function main(): Promise<void> {
  const tmp = resolve(root, ".tmp"); await mkdir(tmp, { recursive: true }); const tmpInfo = await lstat(tmp); if (!tmpInfo.isDirectory() || tmpInfo.isSymbolicLink()) throw new Error("Invalid .tmp directory");
  const runDir = await mkdtemp(resolve(tmp, "pith-obsidian-e2e-"));
  const userDataDir = resolve(runDir, "profile");
  const { configDir, workspacePath } = await prepareIsolatedVault(devVault, resolve(root, "dist/obsidian"));
  const settingsPath = `${workspacePath}/_cache/web-settings.json`;
  const stub = await startSpeechStub();
  let stubFailure: unknown;
  let success: Record<string, unknown> | undefined;
  try {
  const { initial, expected } = speechVerificationFixture(stub.base);
  await mkdir(resolve(devVault, workspacePath, "_cache"), { recursive: true });
  await writeFile(resolve(devVault, settingsPath), JSON.stringify(initial), { flag: "wx" });
  const pluginHashes: Record<string, string> = {};
  for (const name of ["main.js", "styles.css", "manifest.json"]) {
    const built = await readFile(resolve(root, "dist/obsidian", name));
    const deployed = await readFile(resolve(devVault, configDir, "plugins/pith", name));
    if (!built.equals(deployed)) throw new Error(`Isolated plugin differs from build: ${name}`);
    pluginHashes[name] = createHash("sha256").update(deployed).digest("hex");
  }
  const appDataDir = resolve(userDataDir, "Library/Application Support/obsidian");
  await mkdir(appDataDir, { recursive: true });
  const registry = JSON.stringify(isolatedVaultRegistry(Date.now()));
  await writeFile(resolve(appDataDir, "obsidian.json"), registry);
  await writeFile(resolve(userDataDir, "obsidian.json"), registry);

  const port = await findFreePort();
  const child = spawn(obsidianBin, isolatedLaunchArgs(userDataDir, port), {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, HOME: userDataDir, CFFIXED_USER_HOME: userDataDir, PITH_SPEECH_HOME: resolve(runDir, "speech"), PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-8192); });
  const exited = new Promise<void>((resolveExit, rejectExit) => { child.once("exit", () => resolveExit()); child.once("error", rejectExit); });
  void exited.catch(() => {});
  let report: Record<string, unknown> | undefined;
  let failure: unknown;

  try {
    if (!child.pid) throw new Error("Obsidian did not spawn");
    const starterTargets = await pollJson(`http://127.0.0.1:${port}/json/list`, child, url => url === "app://obsidian.md/starter.html");
    const starter = starterTargets.find(t => t.url === "app://obsidian.md/starter.html")!;
    const deadline = Date.now() + 15_000;
    while (true) {
      if (await evaluateInPage<boolean>(starter.webSocketDebuggerUrl, 'typeof window.electron?.ipcRenderer?.sendSync === "function"')) break;
      if (Date.now() >= deadline) throw new Error("Starter IPC did not become ready");
      await new Promise(r => setTimeout(r, 200));
    }
    const opened = await evaluateInPage<unknown>(starter.webSocketDebuggerUrl, `(() => { localStorage.setItem("devvault00000001-config", ${JSON.stringify(configDir)}); localStorage.setItem("enable-plugin-devvault00000001", "true"); if (localStorage.getItem("devvault00000001-config") !== ${JSON.stringify(configDir)}) throw new Error("Configuration override failed"); return window.electron.ipcRenderer.sendSync("vault-open", ${JSON.stringify(devVault)}, false); })()`);
    if (opened !== true) throw new Error(`Vault open failed: ${JSON.stringify(opened)}`);
    const targets = await pollJson(`http://127.0.0.1:${port}/json/list`, child, url => url.startsWith("app://obsidian.md/") && !url.includes("starter.html"));
    const page = targets.find(t => t.url.startsWith("app://obsidian.md/") && !t.url.includes("starter.html"))!;

    if (child.exitCode !== null || child.signalCode !== null || !child.pid) throw new Error("Owned Obsidian process exited before CDP was ready");
    report = await evaluateInPage<{
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
          if (app.vault.configDir !== ${JSON.stringify(configDir)}) return { ok: false, error: "unexpected vault configuration directory: " + app.vault.configDir + "; appId: " + app.appId };
          if (app.plugins.setEnable) await app.plugins.setEnable(true);
          if (!app.plugins.plugins["pith"]) {
            await app.plugins.enablePlugin("pith");
          }
          while (Date.now() < deadline && (!app.plugins.plugins["pith"] || !app.plugins.plugins["pith"].controller || !(app.setting.pluginTabs || []).some(t => t.id === "pith"))) await new Promise(r => setTimeout(r, 100));
          const plugin = app.plugins.plugins["pith"];
          if (!plugin) return { ok: false, error: "pith plugin instance not loaded" };
          if (plugin.getWorkspacePath() !== ${JSON.stringify(workspacePath)}) return { ok: false, error: "unexpected Pith workspace" };
          if (!plugin.controller) return { ok: false, error: "pith controller unavailable" };
          const access = plugin.secretAccess, originalGetSecret = access.getSecret; let secretReads = 0;
          access.getSecret = () => { secretReads++; throw new Error("Local verification must not read secrets"); };
          try {
            await plugin.openView();
            const leaves = app.workspace.getLeavesOfType("pith-reader");
            if (!leaves.length) return { ok: false, error: "pith-reader leaf not mounted" };

            app.setting.open(); app.setting.openTabById("pith");
            const tabInstance = (app.setting.pluginTabs || []).find((t) => t.id === "pith");
            const hostEl = tabInstance && tabInstance.containerEl;
            if (!hostEl || !hostEl.isConnected) throw new Error("Pith settings UI is not mounted");
            const settingLabels = Array.from(hostEl.querySelectorAll("label")).map(l => l.childNodes[0]?.textContent?.trim() || "");
            const row = Array.from(hostEl.querySelectorAll("label")).find(l => l.firstChild && l.firstChild.textContent === "语音服务模式");
            const mode = row && row.querySelector("select");
            if (!mode || mode.value !== "cloud") throw new Error("Expected seeded cloud speech mode");
            mode.value = "local"; mode.dispatchEvent(new Event("change", { bubbles: true }));
            if (!(tabInstance.pending instanceof Promise)) throw new Error("Settings save queue unavailable");
            await tabInstance.pending;
            const expected = ${JSON.stringify(expected.speech)};
            const current = plugin.controller.getSpeechConfig();
            if (Object.keys(current).length !== Object.keys(expected).length || !Object.entries(expected).every(([key, value]) => current[key] === value)) throw new Error("Speech mode change was not saved by settings");
            const persisted = JSON.parse(await app.vault.adapter.read(${JSON.stringify(settingsPath)}));
            if (persisted.speech.ttsProvider !== "kokoro-local" || persisted.speech.asrProvider !== "whisper-local") throw new Error("Local speech mode was not persisted");
            const runtimePanel = hostEl.querySelector("#pith-runtime");
            if (!runtimePanel || runtimePanel.hidden) throw new Error("Local speech controls are not mounted");
            const ttsHealth = await plugin.controller.runtime.getService("speech.tts").checkHealth();
            const asrHealth = await plugin.controller.runtime.getService("speech.asr").checkHealth();
            if (!ttsHealth.ok || !asrHealth.ok) throw new Error("Owned speech stub health check failed: " + JSON.stringify({ ttsHealth, asrHealth }));
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
              settingsMounted: true,
              initialSpeechMode: "cloud",
              savedSpeechMode: "local",
              ttsHealth,
              asrHealth,
            };
          } finally { access.getSecret = originalGetSecret; }
        } catch (err) {
          return { ok: false, error: err && err.stack ? err.stack : String(err) };
        }
      })()`,
    );

    if (!report) throw new Error("Obsidian E2E produced no report");
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
    verifySavedSpeech(persisted, expected);
    if (!stub.requests.includes("GET /health")) throw new Error("TTS health check did not reach the owned stub");
    if (!stub.requests.includes("GET /asr/health")) throw new Error("ASR health check did not reach the owned stub");
    await screenshot(page.webSocketDebuggerUrl, resolve(runDir, "settings.png"));
    await evaluateInPage(page.webSocketDebuggerUrl, "window.app.setting.close()");
    await screenshot(page.webSocketDebuggerUrl, resolve(runDir, "reader.png"));
  } catch (error) {
    failure = error;
  } finally {
    try { await stopOwnedChild(child, exited); }
    catch (error) { throw new AggregateError(failure ? [failure, error] : [error], `Cannot confirm child exit; profile retained at ${runDir}`); }
  }
  if (failure) throw new Error(`Obsidian E2E failed; isolated files retained at ${runDir}, ${configDir}, ${workspacePath}. Obsidian stderr: ${stderr}`, { cause: failure });
  success = { ok: true, cdpPort: port, ...report, profile: userDataDir, configDir, workspacePath, pluginHashes, stubRequests: stub.requests, ownedChildStopped: child.exitCode !== null || child.signalCode !== null, screenshots: [resolve(runDir, "settings.png"), resolve(runDir, "reader.png")] };
  } catch (error) { stubFailure = error; }
  try { await stub.close(); }
  catch (error) { throw new AggregateError(stubFailure ? [stubFailure, error] : [error], "Speech stub cleanup failed"); }
  if (stubFailure) throw stubFailure;
  if (!success) throw new Error("Missing verification result");
  success.stubClosed = true;
  await writeFile(resolve(runDir, "report.json"), JSON.stringify(success, null, 2) + "\n");
  console.log(JSON.stringify(success, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
