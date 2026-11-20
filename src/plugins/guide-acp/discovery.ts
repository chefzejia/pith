import type { AcpConfigOptionDescriptor, AgentProcessPort, DiscoveredAgentDescriptor, LocalAgentId } from "../../core/index.ts";
import { runOneShotAcpPrompt } from "./acpSession.ts";

export interface LocalAgentCandidateSpec {
  readonly id: LocalAgentId | (string & {});
  readonly label: string;
  readonly commands: readonly {
    readonly command: string;
    readonly args: readonly string[];
    readonly versionArgs?: readonly string[];
    readonly detectArgs?: readonly string[];
    readonly detectPattern?: RegExp;
    readonly pithToolTitlePrefix?: string;
    readonly httpMcpWithoutCapability?: boolean;
    readonly requiredSafeModes?: readonly string[];
    readonly nonAcpCli?: boolean;
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
        pithToolTitlePrefix: "mcp__pith__",
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
        pithToolTitlePrefix: "mcp__pith__",
        requiredSafeModes: ["default"],
      },
      {
        command: "claude",
        args: [],
        versionArgs: ["--version"],
        nonAcpCli: true,
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
        pithToolTitlePrefix: "mcp.pith.",
        requiredSafeModes: ["read-only"],
      },
      {
        command: "codex",
        args: [],
        versionArgs: ["--version"],
        nonAcpCli: true,
      },
    ],
    installHint: "请安装 `@agentclientprotocol/codex-acp` (`npm i -g @agentclientprotocol/codex-acp`)",
  },
  {
    id: "agy",
    label: "Antigravity",
    commands: [
      {
        command: "agy",
        args: ["acp", "--sandbox"],
        versionArgs: ["--version"],
        detectArgs: ["acp", "--help"],
        detectPattern: /agent client protocol|acp/i,
        pithToolTitlePrefix: "Run mcp_pith_",
        httpMcpWithoutCapability: true,
        requiredSafeModes: ["default"],
      },
    ],
    installHint: "请安装 Antigravity CLI (`agy`) 并确保支持 `agy acp`",
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
  const timeoutMs = options.timeoutMs ?? 10_000;

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
          lastNote = entry.nonAcpCli
            ? `已检测到本机 ${entry.command} CLI，但裸 ${entry.command} CLI 不是 ACP 服务；${spec.installHint}`
            : `${entry.command} 存在，但版本探测失败；不视为可用 ACP endpoint`;
          continue;
        }
        foundVersion = versionOut.split(/\r?\n/)[0]?.trim().slice(0, 200) ?? null;

        if (entry.nonAcpCli) {
          lastNote = `已检测到本机 ${entry.command} CLI（${foundVersion ?? "unknown"}），但裸 ${entry.command} CLI 不是 ACP 服务；${spec.installHint}`;
          continue;
        }

        if (entry.detectArgs) {
          const detectOut = await probeExec(executable, entry.detectArgs);
          const pattern = entry.detectPattern ?? /.*/;
          if (!detectOut || !pattern.test(detectOut)) {
            lastNote = `${entry.command} 未通过 ACP profile 探测；不猜测为可用`;
            continue;
          }
        }

        return {
          id: spec.id,
          label: spec.label,
          command: executable,
          args: [...entry.args],
          version: foundVersion,
          available: true,
          note: "已检测到 ACP endpoint；连接后由 initialize 证明能力",
          ...(entry.pithToolTitlePrefix !== undefined ? { pithToolTitlePrefix: entry.pithToolTitlePrefix } : {}),
          ...(entry.httpMcpWithoutCapability !== undefined ? { httpMcpWithoutCapability: entry.httpMcpWithoutCapability } : {}),
          ...(entry.requiredSafeModes !== undefined ? { requiredSafeModes: [...entry.requiredSafeModes] } : {}),
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
  private inflightDetect: Promise<readonly DiscoveredAgentDescriptor[]> | null = null;
  private readonly ttlMs: number;
  private readonly options: DiscoverLocalAgentsOptions;
  private readonly now: () => number;
  private readonly optionCache = new Map<string, { at: number; options: readonly AcpConfigOptionDescriptor[] }>();
  private readonly inflightOptions = new Map<string, Promise<readonly AcpConfigOptionDescriptor[]>>();

  constructor(options: DiscoverLocalAgentsOptions = {}, ttlMs = 30_000, now: () => number = () => Date.now()) {
    this.options = options;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  private cloneDescriptors(descriptors: readonly DiscoveredAgentDescriptor[]): DiscoveredAgentDescriptor[] {
    return descriptors.map((d) => ({
      ...d,
      args: [...d.args],
      ...(d.requiredSafeModes !== undefined ? { requiredSafeModes: [...d.requiredSafeModes] } : {}),
    }));
  }

  async detect(force = false): Promise<readonly DiscoveredAgentDescriptor[]> {
    if (!force && this.cache && this.now() - this.cache.at < this.ttlMs) {
      return this.cloneDescriptors(this.cache.descriptors);
    }
    if (this.inflightDetect) {
      return this.cloneDescriptors(await this.inflightDetect);
    }
    const pending = (async () => {
      const descriptors = await discoverLocalAgents(this.options);
      this.cache = { at: this.now(), descriptors };
      return descriptors;
    })();
    this.inflightDetect = pending;
    try {
      return this.cloneDescriptors(await pending);
    } finally {
      if (this.inflightDetect === pending) {
        this.inflightDetect = null;
      }
    }
  }

  async probeAgentOptions(agentId: string, force = false): Promise<readonly AcpConfigOptionDescriptor[]> {
    const cached = this.optionCache.get(agentId);
    if (!force && cached && this.now() - cached.at < this.ttlMs) {
      return cached.options;
    }
    const inflight = this.inflightOptions.get(agentId);
    if (inflight) {
      return inflight;
    }
    const pending = (async () => {
      const descriptor = (await this.detect(force)).find(item => item.id === agentId);
      if (!descriptor || !descriptor.available || !this.options.processPort) throw new Error("Agent 不可用");
      let result;
      try { result = await runOneShotAcpPrompt("", { descriptor, processPort: this.options.processPort, timeoutMs: this.options.timeoutMs, probeOnly: true }); }
      catch (error) { throw new Error(`检测 ${descriptor.label} 配置失败：${error instanceof Error ? error.message : String(error)}`); }
      const options = result.configOptions ?? [];
      this.optionCache.set(agentId, { at: this.now(), options });
      return options;
    })();
    this.inflightOptions.set(agentId, pending);
    try {
      return await pending;
    } finally {
      if (this.inflightOptions.get(agentId) === pending) {
        this.inflightOptions.delete(agentId);
      }
    }
  }
}
