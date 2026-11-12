import { execFile, spawn } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { AgentProcessPort, AgentProcessSpawnSpec, AgentStdioHandle } from "../../core/index.ts";

const execFileAsync = promisify(execFile);

export function defaultAgentSearchPaths(): readonly string[] {
  return [
    ...new Set(
      [
        ...(process.env.PATH ?? "").split(delimiter),
        join(homedir(), ".local", "bin"),
        join(homedir(), ".bun", "bin"),
        join(homedir(), ".volta", "bin"),
        join(homedir(), ".npm-global", "bin"),
        join(homedir(), "Library", "pnpm"),
        ...(process.platform === "darwin" ? ["/opt/homebrew/bin", "/usr/local/bin"] : []),
      ].filter(Boolean),
    ),
  ];
}

function buildAgentEnvironment(
  cliPath: string,
  overrides: Readonly<Record<string, string | undefined>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  const pathKey =
    process.platform === "win32"
      ? (Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "Path")
      : "PATH";
  env[pathKey] = [
    ...new Set(
      [
        ...(isAbsolute(cliPath) ? [dirname(cliPath)] : []),
        ...(env[pathKey] ?? "").split(delimiter),
        ...defaultAgentSearchPaths(),
      ].filter(Boolean),
    ),
  ].join(delimiter);
  return env;
}

export class NodeAgentProcessPort implements AgentProcessPort {
  private readonly customSearchPaths?: readonly string[];
  private readonly workspaceRoot?: string;

  constructor(options?: { searchPaths?: readonly string[]; workspaceRoot?: string }) {
    this.customSearchPaths = options?.searchPaths;
    this.workspaceRoot = options?.workspaceRoot;
  }

  searchPaths(): readonly string[] {
    return this.customSearchPaths ?? defaultAgentSearchPaths();
  }

  async findExecutable(command: string, searchPaths?: readonly string[]): Promise<string | null> {
    if (!command.trim() || command.includes("\u0000")) return null;
    const paths = searchPaths ?? this.searchPaths();
    const explicit =
      isAbsolute(command) ||
      command.includes(sep) ||
      (process.platform === "win32" && /^[a-zA-Z]:[\\/]/.test(command));
    const candidates = explicit
      ? [resolve(command)]
      : paths
          .filter(Boolean)
          .flatMap((dir) =>
            process.platform === "win32"
              ? [join(dir, `${command}.exe`), join(dir, command)]
              : [join(dir, command)],
          );
    const seen = new Set<string>();
    for (const candidate of candidates) {
      try {
        await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        const canonical = await realpath(candidate);
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        return resolve(candidate);
      } catch {
        // continue searching
      }
    }
    return null;
  }

  async probeExecutable(
    executablePath: string,
    args: readonly string[],
    timeoutMs = 4_000,
  ): Promise<string | null> {
    const cwd = await mkdtemp(join(tmpdir(), "pith-acp-probe-"));
    try {
      const env = buildAgentEnvironment(executablePath);
      const result = await execFileAsync(executablePath, [...args], {
        cwd,
        env,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 128 * 1024,
        windowsHide: true,
        shell: false,
      });
      return `${result.stdout}\n${result.stderr}`.trim();
    } catch {
      return null;
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }

  async spawnStdio(spec: AgentProcessSpawnSpec): Promise<AgentStdioHandle> {
    let command = spec.command;
    let args = [...(spec.args ?? [])];
    const tempSandboxCwd = await mkdtemp(join(tmpdir(), "pith-guide-"));
    const readOnlyPaths = [...(this.workspaceRoot ? [this.workspaceRoot] : []), ...(spec.readOnlyPaths ?? [])];

    try { if (readOnlyPaths.length > 0 && process.platform === "darwin") {
      if (!existsSync("/usr/bin/sandbox-exec")) throw new Error("macOS sandbox-exec unavailable");
      const resolvedPaths = [
        ...new Set(await Promise.all(readOnlyPaths.map((p) => realpath(p)))),
      ];
      if (resolvedPaths.some((p) => /[\u0000-\u001f\u007f]/u.test(p))) {
        throw new Error("Unsafe path in readOnlyPaths for sandbox-exec");
      }
      const denied = resolvedPaths
        .map((p) => `(subpath "${p.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}")`)
        .join(" ");
      const profile = `(version 1) (allow default) (deny file-write* ${denied})`;
      args = ["-p", profile, command, ...args];
      command = "/usr/bin/sandbox-exec";
    } } catch (error) { await rm(tempSandboxCwd, { recursive: true, force: true }); throw error; }

    const cwd = tempSandboxCwd;
    const env = buildAgentEnvironment(spec.command, spec.env);
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });

    try { await new Promise<void>((resolveSpawn, rejectSpawn) => {
      const onError = (err: Error) => {
        child.off("spawn", onSpawn);
        rejectSpawn(err);
      };
      const onSpawn = () => {
        child.off("error", onError);
        resolveSpawn();
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    }); } catch (error) { await rm(tempSandboxCwd, { recursive: true, force: true }); throw error; }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const lineListeners = new Set<(line: string) => void>();
    const errorListeners = new Set<(error: Error) => void>();
    const exitListeners = new Set<(code: number | null, signal: string | null) => void>();
    let buffer = "";

    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        for (const listener of lineListeners) listener(line);
        idx = buffer.indexOf("\n");
      }
    });

    child.on("error", (err) => {
      for (const listener of errorListeners) listener(err);
    });

    child.on("close", (code, signal) => {
      if (buffer.length > 0) {
        const tail = buffer.replace(/\r$/, "");
        buffer = "";
        for (const listener of lineListeners) listener(tail);
      }
      for (const listener of exitListeners) listener(code, signal);
    });

    const handle: AgentStdioHandle & { readonly cwd: string } = {
      pid: child.pid,
      cwd: resolve(cwd),
      writeLine(line: string): Promise<void> {
        return new Promise((resolveWrite, rejectWrite) => {
          if (!child.stdin.writable) {
            rejectWrite(new Error("Agent stdin is not writable"));
            return;
          }
          child.stdin.write(`${line.replace(/\r?\n$/, "")}\n`, "utf8", (err) => {
            if (err) rejectWrite(err);
            else resolveWrite();
          });
        });
      },
      onLine(listener: (line: string) => void): () => void {
        lineListeners.add(listener);
        return () => lineListeners.delete(listener);
      },
      onError(listener: (error: Error) => void): () => void {
        errorListeners.add(listener);
        return () => errorListeners.delete(listener);
      },
      onExit(listener: (code: number | null, signal: string | null) => void): () => void {
        exitListeners.add(listener);
        return () => exitListeners.delete(listener);
      },
      async close(timeoutMs = 2_000): Promise<void> {
        try {
          if (child.exitCode === null && child.signalCode === null) {
            child.stdin.end();
            child.kill("SIGTERM");
            await new Promise<void>((resolveClose) => {
              const timer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                  child.kill("SIGKILL");
                }
                resolveClose();
              }, timeoutMs);
              child.once("close", () => {
                clearTimeout(timer);
                resolveClose();
              });
            });
          }
        } finally {
          if (tempSandboxCwd) {
            await rm(tempSandboxCwd, { recursive: true, force: true });
          }
        }
      },
    };
    return handle;
  }
}
