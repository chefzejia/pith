import assert from "node:assert/strict";
import test from "node:test";
import {
  PluginRuntime,
  isApiCompatible,
  type HostPort,
  type PluginManifest,
} from "../src/core/index.ts";
import { bootStandaloneShell } from "../src/shells/web/index.ts";

test("configuration changes remount active providers and transitive consumers in dependency order", () => {
  const events: string[] = [];
  const plugin = (id: string, requires: string[], provides: string[]): PluginManifest => ({
    id, name: id, description: id, requires, provides,
    ...(id === "provider" ? { settings: { value: { type: "string" as const, title: "Value", default: "one" } } } : {}),
    apply(ctx) {
      events.push(`start:${id}:${ctx.config.value ?? ""}`);
      for (const service of provides) ctx.provide(service, ctx.config.value ?? id);
      ctx.onDispose(() => events.push(`stop:${id}`));
    },
  });
  const rt = new PluginRuntime([plugin("provider", [], ["provider.service"]), plugin("consumer", ["provider.service"], ["consumer.service"]), plugin("downstream", ["consumer.service"], []), plugin("unrelated", [], [])]);
  const config = (value: string) => ({ plugins: { provider: { config: { value } } } });
  rt.reconcile(config("one")); events.length = 0;
  rt.reconcile(config("one")); assert.deepEqual(events, []);
  rt.reconcile(config("two"));
  assert.deepEqual(events, ["stop:downstream", "stop:consumer", "stop:provider", "start:provider:two", "start:consumer:", "start:downstream:"]);
  assert.equal(rt.getService("provider.service"), "two");
});

test("failed remount disposes dependent services without affecting unrelated plugins", () => {
  const events: string[] = [];
  const rt = new PluginRuntime([
    { id: "provider", name: "Provider", description: "", provides: ["example"], settings: { value: { type: "string", title: "Value", default: "ok" } }, apply(ctx) { ctx.onDispose(() => events.push("provider disposed")); if (ctx.config.value === "bad") throw new Error("bad config"); ctx.provide("example", ctx.config.value); } },
    { id: "consumer", name: "Consumer", description: "", requires: ["example"], apply(ctx) { ctx.onDispose(() => events.push("consumer disposed")); } },
    { id: "unrelated", name: "Unrelated", description: "" },
  ]);
  rt.reconcile({ plugins: { provider: { config: { value: "ok" } } } });
  rt.reconcile({ plugins: { provider: { config: { value: "bad" } } } });
  assert.deepEqual(events, ["consumer disposed", "provider disposed", "provider disposed"]);
  assert.equal(rt.active("unrelated"), true);
  assert.equal(rt.getService("example"), undefined);
  assert.equal(rt.statuses().find(status => status.id === "provider")!.state, "failed");
  assert.equal(rt.statuses().find(status => status.id === "consumer")!.state, "pending");
  rt.reconcile({ plugins: { provider: { config: { value: "fixed" } } } });
  assert.equal(rt.getService("example"), "fixed");
  assert.equal(rt.active("provider"), true);
  assert.equal(rt.active("consumer"), true);
});

test("reconfiguring a lower stacked provider preserves the active provider priority", () => {
  const rt = new PluginRuntime([
    { id: "a", name: "A", description: "", provides: ["stacked"], settings: { value: { type: "string", title: "Value", default: "old" } }, apply(ctx) { ctx.provide("stacked", ctx.config.value); } },
    { id: "b", name: "B", description: "", provides: ["stacked"], apply(ctx) { ctx.provide("stacked", "upper"); } },
  ]);
  rt.reconcile({ plugins: { a: { config: { value: "old" } } } });
  assert.equal(rt.getService("stacked"), "upper");
  rt.reconcile({ plugins: { a: { config: { value: "new" } } } });
  assert.equal(rt.getService("stacked"), "upper");
  rt.reconcile({ plugins: { a: { config: { value: "new" } }, b: { enabled: false } } });
  assert.equal(rt.getService("stacked"), "new");
});

test("stacked providers recover from a failed reconfiguration without disturbing unrelated plugins", () => {
  const events: string[] = [];
  const rt = new PluginRuntime([
    { id: "a", name: "A", description: "", provides: ["service"], settings: { value: { type: "string", title: "Value", default: "ok" } }, apply(ctx) { events.push(`start:a:${ctx.config.value}`); ctx.onDispose(() => events.push("stop:a")); if (ctx.config.value === "bad") throw new Error("invalid"); ctx.provide("service", ctx.config.value); } },
    { id: "b", name: "B", description: "", provides: ["service"], apply(ctx) { events.push("start:b"); ctx.onDispose(() => events.push("stop:b")); ctx.provide("service", "upper"); } },
    { id: "c", name: "C", description: "", requires: ["service"], provides: ["dependent"], apply(ctx) { events.push(`start:c:${ctx.service("service")}`); ctx.onDispose(() => events.push("stop:c")); ctx.provide("dependent", true); } },
    { id: "d", name: "D", description: "", requires: ["dependent"], apply(ctx) { events.push("start:d"); ctx.onDispose(() => events.push("stop:d")); } },
    { id: "unrelated", name: "Unrelated", description: "", apply(ctx) { events.push("start:unrelated"); ctx.onDispose(() => events.push("stop:unrelated")); } },
  ]);
  const config = (value: string) => ({ plugins: { a: { config: { value } } } });
  rt.reconcile(config("ok")); events.length = 0;
  rt.reconcile(config("bad"));
  assert.deepEqual(events, ["stop:d", "stop:c", "stop:b", "stop:a", "start:a:bad", "stop:a", "start:b", "start:c:upper", "start:d"]);
  assert.equal(rt.getService("service"), "upper");
  events.length = 0;
  rt.reconcile(config("fixed"));
  assert.deepEqual(events, ["stop:d", "stop:c", "stop:b", "start:a:fixed", "start:b", "start:c:upper", "start:d"]);
  assert.equal(rt.getService("service"), "upper");
  rt.reconcile({ plugins: { a: { config: { value: "fixed" } }, b: { enabled: false } } });
  assert.equal(rt.getService("service"), "fixed");
  rt.stop();
});

test("Reconcile: topological order, failed plugin rollback, reverse cascading disposal", () => {
  const events: string[] = [];
  const note = (label: string) => () => {
    events.push(label);
  };

  const manifests: PluginManifest[] = [
    {
      id: "consumer-a",
      requires: ["svc.b"],
      name: "A",
      description: "Requires B",
      apply(ctx) {
        assert.equal(ctx.service("svc.b"), "service-b-instance");
        ctx.onDispose(note("a.1"));
        ctx.onDispose(note("a.2"));
      },
    },
    {
      id: "provider-b",
      provides: ["svc.b"],
      name: "B",
      description: "Provides B",
      apply(ctx) {
        ctx.provide("svc.b", "service-b-instance");
        ctx.onDispose(note("b"));
      },
    },
    {
      id: "broken",
      name: "Broken",
      description: "Throws mid-apply after registering a disposer",
      apply(ctx) {
        ctx.onDispose(note("broken.partial"));
        throw new Error("boom");
      },
    },
    {
      id: "future-api",
      api: "^2",
      name: "Future",
      description: "Targets major API 2",
    },
    {
      id: "waiting",
      requires: ["svc.missing"],
      name: "Waiting",
      description: "Waits for an unprovided service",
    },
    {
      id: "ui-only",
      name: "UI",
      description: "Plugin without services",
    },
  ];

  const rt = new PluginRuntime(manifests);
  rt.reconcile({
    "consumer-a": true,
    "provider-b": true,
    broken: true,
    "future-api": true,
    waiting: true,
    "ui-only": true,
  });

  // Broken plugin's partial disposer ran immediately on failure; others still activated
  assert.deepEqual(events, ["broken.partial"]);
  events.length = 0;

  const byId = new Map(rt.statuses().map((s) => [s.id, s]));
  assert.equal(byId.get("provider-b")?.state, "active");
  assert.equal(byId.get("consumer-a")?.state, "active");
  assert.equal(byId.get("broken")?.state, "failed");
  assert.equal(byId.get("future-api")?.state, "failed");
  assert.equal(byId.get("waiting")?.state, "pending");
  assert.match(byId.get("waiting")?.why ?? "", /svc\.missing/);
  assert.equal(byId.get("ui-only")?.state, "active");

  // Turn off provider-b while consumer-a still wants to be on:
  // consumer-a must dispose first (newest first: a.2 -> a.1), then provider-b ("b").
  rt.reconcile({
    "consumer-a": true,
    "provider-b": false,
    "ui-only": true,
  });

  assert.deepEqual(events, ["a.2", "a.1", "b"]);
  assert.equal(rt.active("provider-b"), false);
  assert.equal(rt.active("consumer-a"), false);
  assert.equal(rt.active("ui-only"), true);

  // Turn provider-b back on: consumer-a recovers automatically
  events.length = 0;
  rt.reconcile({
    "consumer-a": true,
    "provider-b": true,
    "ui-only": true,
  });
  assert.equal(rt.active("provider-b"), true);
  assert.equal(rt.active("consumer-a"), true);

  rt.stop();
  assert.deepEqual(events, ["a.2", "a.1", "b"]);
});

test("Compose & InUse guard: active Topic keeps plugin on under essentials preset or explicit off", () => {
  let topicsUsingDojo = 2;
  const manifests: PluginManifest[] = [
    {
      id: "core-stage",
      essential: true,
      name: "Core Stage",
      description: "Essential reading stage",
    },
    {
      id: "dojo-shadowing",
      essential: false,
      name: "Shadowing",
      description: "Optional language dojo",
      inUse: () => topicsUsingDojo,
      settings: {
        speed: { type: "number", title: "Speed", default: 1, minimum: 0.5, maximum: 2 },
      },
    },
  ];

  const rt = new PluginRuntime(manifests);
  rt.reconcile({
    preset: "essentials",
    plugins: {
      "dojo-shadowing": {
        enabled: false,
        config: { speed: 99 }, // invalid out-of-range value -> falls back to default 1
      },
    },
  });

  // Because 2 Topics use dojo-shadowing, InUse forces it active despite essentials + enabled:false
  assert.equal(rt.active("core-stage"), true);
  assert.equal(rt.active("dojo-shadowing"), true);
  const dojoStatus = rt.statuses().find((s) => s.id === "dojo-shadowing");
  assert.equal(dojoStatus?.source, "in-use");
  assert.equal(dojoStatus?.inUseCount, 2);

  const composed = rt.compose({
    preset: "essentials",
    plugins: { "dojo-shadowing": { enabled: false, config: { speed: 99 } } },
  });
  assert.equal(composed.find((p) => p.id === "dojo-shadowing")?.config["speed"], 1);

  // Once no Topic uses it anymore, reconciling turns it off cleanly
  topicsUsingDojo = 0;
  rt.reconcile({
    preset: "essentials",
    plugins: { "dojo-shadowing": { enabled: false } },
  });
  assert.equal(rt.active("dojo-shadowing"), false);
});

test("Standalone shell boots all built-in plugins cleanly without Obsidian", () => {
  const memoryHost: HostPort = {
    id: "memory",
    storage: {
      exists: async () => false,
      readText: async () => "",
      readBinary: async () => new Uint8Array(),
      writeText: async () => {},
      createText: async () => {},
      writeBinary: async () => {},
      createBinary: async () => {},
      processText: async (_p, fn) => fn(""),
      mkdir: async () => {},
      list: async () => [],
    },
  };

  const rt = bootStandaloneShell(memoryHost, { preset: "all" });
  assert.equal(rt.active("stage-reader"), true);
  assert.equal(rt.active("stage-timeline"), true);
  assert.equal(rt.active("speech-service"), true);
  assert.equal(rt.active("dojo-shadowing"), true);
  assert.equal(rt.active("guide-acp"), true);
  rt.stop();
});

test("API version caret compatibility matches Magpie rules", () => {
  assert.equal(isApiCompatible(""), true);
  assert.equal(isApiCompatible("^1"), true);
  assert.equal(isApiCompatible("^1.0"), true);
  assert.equal(isApiCompatible("^1.1"), false);
  assert.equal(isApiCompatible("^2"), false);
  assert.equal(isApiCompatible("1.0"), false);
});

test("Compose transitive in-use: kept-alive dojo automatically pulls in its required base providers", () => {
  let activeShadowingTopics = 1;
  const manifests: PluginManifest[] = [
    {
      id: "speech-service",
      essential: false,
      provides: ["speech.asr"],
      name: "Speech",
      description: "Base ASR provider",
      apply(ctx) {
        ctx.provide("speech.asr", { engine: "whisper-local" });
      },
    },
    {
      id: "stage-timeline",
      essential: false,
      provides: ["stage.timeline"],
      name: "Timeline",
      description: "Base media timeline provider",
      apply(ctx) {
        ctx.provide("stage.timeline", { player: "html5" });
      },
    },
    {
      id: "dojo-shadowing",
      essential: false,
      requires: ["stage.timeline", "speech.asr"],
      inUse: () => activeShadowingTopics,
      name: "Shadowing",
      description: "4-stage shadowing dojo",
    },
  ];

  const rt = new PluginRuntime(manifests);

  // Under "essentials", all three are non-essential, but dojo-shadowing is inUse (1).
  // Compose must transitively promote speech-service and stage-timeline so dojo-shadowing reaches "active"!
  rt.reconcile({ preset: "essentials" });
  assert.equal(rt.active("speech-service"), true);
  assert.equal(rt.active("stage-timeline"), true);
  assert.equal(rt.active("dojo-shadowing"), true);

  // Once the user archives the Topic (inUse -> 0), all three turn off under essentials
  activeShadowingTopics = 0;
  rt.reconcile({ preset: "essentials" });
  assert.equal(rt.active("dojo-shadowing"), false);
  assert.equal(rt.active("stage-timeline"), false);
  assert.equal(rt.active("speech-service"), false);
});

test("Service stacking: later provider takes over top-of-stack and falls back cleanly on dispose", () => {
  const consumerDisposed: string[] = [];
  const manifests: PluginManifest[] = [
    {
      id: "tts-01-basic",
      provides: ["speech.tts"],
      name: "Basic System TTS",
      description: "Fallback system speech",
      apply(ctx) {
        ctx.provide("speech.tts", "basic-tts");
      },
    },
    {
      id: "tts-02-hq",
      provides: ["speech.tts"],
      name: "HQ Neural TTS",
      description: "Upgraded neural speech",
      apply(ctx) {
        ctx.provide("speech.tts", "hq-neural-tts");
      },
    },
    {
      id: "reader-readaloud",
      requires: ["speech.tts"],
      name: "Read Aloud",
      description: "Consumer of speech.tts",
      apply(ctx) {
        ctx.onDispose(() => consumerDisposed.push("disposed"));
      },
    },
  ];

  const rt = new PluginRuntime(manifests);

  // 1. Both TTS providers on -> alphabetical activation puts tts-02-hq on top of stack
  rt.reconcile({
    "tts-01-basic": true,
    "tts-02-hq": true,
    "reader-readaloud": true,
  });
  assert.equal(rt.getService("speech.tts"), "hq-neural-tts");
  assert.equal(rt.active("reader-readaloud"), true);

  // 2. Turn off tts-02-hq -> falls back seamlessly to tts-01-basic WITHOUT tearing down reader-readaloud!
  rt.reconcile({
    "tts-01-basic": true,
    "tts-02-hq": false,
    "reader-readaloud": true,
  });
  assert.equal(rt.getService("speech.tts"), "basic-tts");
  assert.equal(rt.active("reader-readaloud"), true);
  assert.deepEqual(consumerDisposed, []);

  // 3. Turn off the last remaining provider -> now reader-readaloud cascades off
  rt.reconcile({
    "tts-01-basic": false,
    "tts-02-hq": false,
    "reader-readaloud": true,
  });
  assert.equal(rt.getService("speech.tts"), undefined);
  assert.equal(rt.active("reader-readaloud"), false);
  assert.deepEqual(consumerDisposed, ["disposed"]);
});
