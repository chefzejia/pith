import type { GuideProvider, WorkspaceStoragePort, WorkspaceStore } from "../src/core/index.ts";
import type { PublicHttpPort } from "../src/plugins/guide-acp/externalIngest.ts";
import { createScopedTools } from "../src/plugins/guide-acp/tools.ts";

export const intakeThought = "Private planning <draft>";
export const intakeReply = "Which part should we study first?";
export const intakeFailure = "Controlled guide failure";

export function intakeMaterialFixture(store: WorkspaceStore, storage: WorkspaceStoragePort) {
  const http: PublicHttpPort = {
    async request() { throw new Error("Unexpected HTTP request"); },
    async requestPublic(spec) {
      const body = "# Lecture notes\n\nControlled material.";
      return { status: 200, headers: { "content-type": "text/markdown" }, bytes: new TextEncoder().encode(body), text: () => body, finalUrl: spec.url };
    },
  };
  let release: (() => void) | undefined;
  const provider: GuideProvider = {
    async run(input, options) {
      if (input.scope.kind !== "intake") throw new Error("Expected an intake turn");
      options.onStep({ kind: "thought", text: intakeThought }, 0);
      const tool = createScopedTools({ store, storage, http, onChoices() {} }).find(item => item.name === "pith_ingest_external")!;
      const args = { title: `Notes for ${input.text}`, urls: ["https://courses.example.com/lecture"] };
      const step = { kind: "tool", callId: "ingest", name: tool.name, inputPreview: JSON.stringify(args), effects: [] } as const;
      options.onStep({ ...step, status: "running" }, 1);
      const result = await tool.execute(args, options.signal);
      const effects = await tool.effects!(result, args);
      const done = new Promise<void>(resolve => { release = resolve; });
      const stop = () => release?.();
      if (options.signal.aborted) stop();
      else options.signal.addEventListener("abort", stop, { once: true });
      try {
        options.onStep({ ...step, status: "completed", effects }, 1);
        await done;
      } finally {
        release = undefined;
        options.signal.removeEventListener("abort", stop);
      }
      if (options.signal.aborted) return { status: "stopped" };
      if (input.text === "failed") return { status: "failed", error: intakeFailure };
      options.onStep({ kind: "reply", markdown: intakeReply }, 2);
      return { status: "completed" };
    },
  };
  return { provider, finish() { release?.(); } };
}
