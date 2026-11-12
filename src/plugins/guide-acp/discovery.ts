import type { AcpConfigOptionDescriptor, AgentProcessPort, DiscoveredAgentDescriptor } from "../../core/index.ts";
import { runOneShotAcpPrompt } from "./acpSession.ts";

export interface LocalAgentCandidateSpec {
  readonly id: "dsh" | "claude" | "codex" | (string & {});
  readonly label: string;
  readonly commands: readonly {
    readonly command: string;
    readonly args: readonly string[];
    readonly versionArgs?: readonly string[];
    readonly detectArgs?: readonly string[];
    readonly detectPattern?: RegExp;
  }[];
  readonly installHint: string;
}

export const BUILTIN_LOCAL_AGENTS: readonly LocalAgentCandidateSpec[] = [
  {
    id: "dsh",
    label: "DeepSeek Harness",
    commands: [
      {
        command: "dsh",
        args: ["--profile", "acp"],
        versionArgs: ["--version"],
        detectArgs: ["--profile", "acp", "--help"],
        detectPattern: /agent client protocol|acp/i,
      },
    ],
    installHint: "请安装 DeepSeek Harness CLI (`dsh`) 并确保支持 `--profile acp`",
  },
  {
    id: "claude",
    label: "Claude Code",
    commands: [
      {
        command: "claude-agent-acp",
        args: [],
        versionArgs: ["--version"],
      },
      {
        command: "claude",
        args: [],
        versionArgs: ["--version"],
      },
    ],
    installHint: "请安装 `@agentclientprotocol/claude-agent-acp` (`npm i -g @agentclientprotocol/claude-agent-acp`)",
  },
  {
    id: "codex",
    label: "Codex",
    commands: [
      {
        command: "codex-acp",
        args: [],
        versionArgs: ["--version"],
      },
      {
        command: "codex",
        args: [],
        versionArgs: ["--version"],
      },
    ],
    installHint: "请安装 `@agentclientprotocol/codex-acp` (`npm i -g @agentclientprotocol/codex-acp`)",
  },
];

export interface DiscoverLocalAgentsOptions {
  readonly processPort?: AgentProcessPort;
  readonly searchPaths?: readonly string[];
  readonly candidates?: readonly LocalAgentCandidateSpec[];
  readonly timeoutMs?: number;
  readonly findExecutable?: (command: string, searchPaths?: readonly string[]) => Promise<string | null>;
  readonly probeRunner?: (executablePath: string, args: readonly string[]) => Promise<string | null>;
}

export async function discoverLocalAgents(
  options: DiscoverLocalAgentsOptions = {},
): Promise<DiscoveredAgentDescriptor[]> {
  const candidates = options.candidates ?? BUILTIN_LOCAL_AGENTS;
  const searchPaths = options.searchPaths ?? options.processPort?.searchPaths?.() ?? [];
  const timeoutMs = options.timeoutMs ?? 4_000;

  const findExec =
    options.findExecutable ??
    (options.processPort
      ? (cmd: string, paths?: readonly string[]) => options.processPort!.findExecutable(cmd, paths)
      : async () => null);

  const probeExec =
    options.probeRunner ??
    (options.processPort
      ? (execPath: string, args: readonly string[]) =>
          options.processPort!.probeExecutable(execPath, args, timeoutMs)
      : async () => null);

  if (!options.findExecutable && !options.probeRunner && !options.processPort) {
    return candidates.map((spec) => ({
      id: spec.id,
      label: spec.label,
      command: null,
      args: [],
      version: null,
      available: false,
      note: `当前宿主未提供本机进程端口（AgentProcessPort）；${spec.installHint}`,
    }));
  }

  return Promise.all(
    candidates.map(async (spec): Promise<DiscoveredAgentDescriptor> => {
      let lastNote = `未找到 ${spec.commands.map((c) => c.command).join(" / ")}；${spec.installHint}`;
      let foundVersion: string | null = null;

      for (const entry of spec.commands) {
        const executable = await findExec(entry.command, searchPaths);
        if (!executable) continue;

        const versionOut = await probeExec(executable, entry.versionArgs ?? ["--version"]);
        if (!versionOut) {
          lastNote = `${entry.command} 存在，但版本探测失败；不视为可用 ACP endpoint`;
          continue;
        }
        foundVersion = versionOut.split(/\r?\n/)[0]?.trim().slice(0, 200) ?? null;

        if (entry.detectArgs) {
          const detectOut = await probeExec(executable, entry.detectArgs);
          const pattern = entry.detectPattern ?? /.*/;
          if (!detectOut || !pattern.test(detectOut)) {
            lastNote = `${entry.command} 未通过 ACP profile 探测；不猜测为可用`;
            continue;
          }
        }

        // For bare `claude` or `codex` without `-acp`, note that the ACP adapter binary is preferred unless it speaks ACP.
        if (entry.command === "claude" || entry.command === "codex") {
          return {
            id: spec.id,
            label: spec.label,
            command: executable,
            args: [...entry.args],
            version: foundVersion,
            available: true,
            note: `已检测到本机 ${entry.command} CLI（${foundVersion ?? "unknown"}）；建议使用 ${entry.command}-agent-acp / ${entry.command}-acp 获得标准 ACP 会话`,
          };
        }

        return {
          id: spec.id,
          label: spec.label,
          command: executable,
          args: [...entry.args],
          version: foundVersion,
          available: true,
          note: "已检测到 ACP endpoint；连接后由 initialize 证明能力",
          ...(spec.id === "dsh" ? { pithToolTitlePrefix: "mcp__pith__" } : {}),
        };
      }

      return {
        id: spec.id,
        label: spec.label,
        command: null,
        args: [],
        version: foundVersion,
        available: false,
        note: lastNote,
      };
    }),
  );
}

export class CachedAgentDetector {
  private cache: { at: number; descriptors: readonly DiscoveredAgentDescriptor[] } | null = null;
  private readonly ttlMs: number;
  private readonly options: DiscoverLocalAgentsOptions;
  private readonly now: () => number;
  private readonly optionCache = new Map<string, { at: number; options: readonly AcpConfigOptionDescriptor[] }>();

  constructor(options: DiscoverLocalAgentsOptions = {}, ttlMs = 30_000, now: () => number = () => Date.now()) {
    this.options = options;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async detect(force = false): Promise<readonly DiscoveredAgentDescriptor[]> {
    const timestamp = this.now();
    if (!force && this.cache && timestamp - this.cache.at < this.ttlMs) {
      return this.cache.descriptors.map((d) => ({ ...d, args: [...d.args] }));
    }
    const descriptors = await discoverLocalAgents(this.options);
    this.cache = { at: timestamp, descriptors };
    return descriptors.map((d) => ({ ...d, args: [...d.args] }));
  }

  async probeAgentOptions(agentId: string, force = false): Promise<readonly AcpConfigOptionDescriptor[]> {
    const cached = this.optionCache.get(agentId), timestamp = this.now();
    if (!force && cached && timestamp - cached.at < this.ttlMs) return cached.options;
    const descriptor = (await this.detect(force)).find(item => item.id === agentId);
    if (!descriptor || !descriptor.available || !this.options.processPort) throw new Error("Agent 不可用");
    let result;
    try { result = await runOneShotAcpPrompt("", { descriptor, processPort: this.options.processPort, timeoutMs: this.options.timeoutMs, probeOnly: true }); }
    catch (error) { throw new Error(`检测 ${descriptor.label} 配置失败：${error instanceof Error ? error.message : String(error)}`); }
    const options = result.configOptions ?? [];
    this.optionCache.set(agentId, { at: timestamp, options });
    return options;
  }
}
