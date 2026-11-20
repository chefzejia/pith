import assert from "node:assert/strict";
import test from "node:test";
import { applyPaginationStyles, renderTocTree, updateTocLocation } from "../src/plugins/stage-reader/pagination.ts";
import { PithSettingTab, createObsidianHostPort, saveObsidianSecret } from "../src/shells/obsidian/index.ts";

test("pagination sizes media after margins and binds one load callback", () => {
  const properties = new Map<string, string>();
  const listeners = new Set<() => void>();
  const image = { tagName: "IMG", complete: false, style: { setProperty: (key: string, value: string) => properties.set(key, value) }, addEventListener: (_: string, callback: () => void) => listeners.add(callback), removeEventListener: (_: string, callback: () => void) => listeners.delete(callback) };
  const style = { setProperty() {}, removeProperty() {} };
  const body = { style, ownerDocument: { defaultView: { getComputedStyle: () => ({ marginTop: "10px", marginBottom: "12px" }) } }, querySelectorAll: (selector: string) => selector === "figure" ? [] : [image] };
  const viewport = { clientWidth: 800, clientHeight: 600, scrollWidth: 800, style };
  const loaded = () => {};
  applyPaginationStyles(viewport as never, body as never, "single", loaded);
  applyPaginationStyles(viewport as never, body as never, "single", loaded);
  assert.equal(properties.get("--pith-page-media-height"), "518px");
  assert.equal(listeners.size, 1);
});

test("secrets fail closed without confirmed encrypted storage", () => {
  let writes = 0;
  const store = { getSecret: () => null, setSecret: () => { writes++; } };
  assert.throws(() => saveObsidianSecret(store, "OPENAI_API_KEY", "test-secret"), /不可用/);
  assert.equal(writes, 0);
  if (["darwin", "win32"].includes(process.platform)) {
    saveObsidianSecret({ ...store, isEncryptionAvailable: () => true }, "OPENAI_API_KEY", "test-secret");
    assert.equal(writes, 1);
  } else assert.throws(() => saveObsidianSecret({ ...store, isEncryptionAvailable: () => true }, "OPENAI_API_KEY", "test-secret"), /不可用/);
});

test("settings save secrets only through encrypted storage and report saved health states", { skip: !["darwin", "win32"].includes(process.platform) }, async () => {
  class Element {
    children: Element[] = []; parentElement: Element | null = null; textContent = ""; value = ""; disabled = false; hidden = false; onclick: (() => void) | null = null; onchange: (() => void) | null = null;
    ownerDocument = { createElement: () => new Element() };
    append(...children: Element[]) { for (const child of children) child.parentElement = this; this.children.push(...children); }
    replaceChildren() { this.children = []; }
    contains(node: Element): boolean { return this === node || this.children.some(child => child.contains(node)); }
    querySelector(selector: string): Element | null { return selector === 'option[value="unconfigured"]' ? this.children.find(child => child.value === "unconfigured") ?? null : null; }
    setAttribute() {} addEventListener(type: string, fn: () => void) { if (type === "change") this.onchange = fn; }
  }
  const values = new Map<string, string>(), writes: unknown[] = [];
  const storage = { getSecret: (id: string) => values.get(id) ?? null, setSecret: (id: string, value: string) => { values.set(id, value); }, isEncryptionAvailable: () => true };
  const plugin = { app: { secretStorage: storage }, saveSpeechSecret: (value: string) => { saveObsidianSecret(storage, "OPENAI_API_KEY", value); return "encrypted"; }, getWorkspacePath: () => "Pith", setWorkspacePath: async () => false };
  const controller = {
    getAgentConfig: () => ({ agentId: "", model: "", effort: "" }), isAgentConfigured: () => true, getSpeechConfig: () => ({}),
    detectAgents: async () => [],
    speechRuntimeState: async () => ({ supported: false, status: "not-installed", note: "unsupported" }),
    setAgentConfig: async (config: unknown) => { writes.push(config); }, setSpeechConfig: async (config: unknown) => { writes.push(config); },
    runtime: { getService: (id: string) => ({ checkHealth: async () => id === "speech.tts" ? { status: "verified", note: "ready" } : { status: "unverified", note: "not checked" } }) },
  };
  const tab = new PithSettingTab({} as never, plugin as never, controller as never), root = new Element();
  tab.containerEl = root as never; tab.display();
  const field = (label: string) => root.children.find(node => node.textContent === label)!.children[0]!;
  field("API Key").value = "test-only-key";
  field("API Key").onchange!();
  const status = root.children.at(-1)!;
  for (let i = 0; i < 20 && !status.textContent; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(status.textContent, "密钥已保存"); assert.equal(field("API Key").value, "");
  assert.ok(!JSON.stringify(writes).includes("test-only-key"));
  const host = createObsidianHostPort({} as never, "Pith", undefined, undefined, storage);
  assert.equal(await host.secrets!.getSecret("OPENAI_API_KEY"), "test-only-key");
  status.textContent = ""; root.children.find(node => node.textContent === "检测连接")!.onclick!();
  for (let i = 0; i < 20 && !status.textContent; i++) await new Promise(resolve => setImmediate(resolve));
  assert.match(status.textContent, /TTS 已验证：ready；ASR 未验证：not checked/);
});

test("TOC nests headings, toggles branches and expands the current heading's ancestors", () => {
  class Element {
    children: Element[] = []; parentElement: Element | null = null; dataset: Record<string, string> = {}; attributes: Record<string, string> = {};
    hidden = false; textContent = ""; className = ""; onclick: (() => void) | null = null;
    readonly tag: string;
    constructor(tag: string) { this.tag = tag; }
    append(...nodes: Element[]) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    removeAttribute(key: string) { delete this.attributes[key]; }
    querySelector(selector: string): Element | null {
      if (selector === ":scope > ul") return this.children.find(child => child.tag === "ul") ?? null;
      if (selector === ":scope > div > [data-toc-toggle]") return this.children.find(child => child.tag === "div")?.children.find(child => "tocToggle" in child.dataset) ?? null;
      return null;
    }
    querySelectorAll(selector: string): Element[] {
      const all = (node: Element): Element[] => node.children.flatMap(child => [child, ...all(child)]);
      return all(this).filter(node => selector === "[data-toc-locator]" ? "tocLocator" in node.dataset : selector === "[data-toc-toggle]" ? "tocToggle" in node.dataset : selector === ".pith-toc-tree ul" && node.tag === "ul" && node.className !== "pith-toc-tree");
    }
    closest(selector: string): Element | null { let node: Element | null = this; while (node && node.tag !== selector) node = node.parentElement; return node; }
  }
  const container = new Element("aside") as Element & { ownerDocument: { createElement(tag: string): Element } };
  container.ownerDocument = { createElement: tag => new Element(tag) };
  const navigated: string[] = [];
  renderTocTree(container as never, [{ title: "Part", level: 1, line: 1, locator: "part" }, { title: "Chapter", level: 2, line: 2, locator: "chapter", children: [{ title: "Detail", level: 3, line: 3, locator: "detail" }] }, { title: "Other", level: 1, line: 4, locator: "other" }], locator => navigated.push(locator));
  const titles = container.querySelectorAll("[data-toc-locator]"), toggles = container.querySelectorAll("[data-toc-toggle]");
  assert.deepEqual(titles.map(node => node.textContent), ["Part", "Chapter", "Detail", "Other"]);
  assert.equal(toggles[0]!.hidden, false); assert.equal(toggles[1]!.hidden, false); assert.equal(toggles[2]!.hidden, true);
  toggles[0]!.onclick!(); assert.equal(toggles[0]!.attributes["aria-expanded"], "true");
  titles[2]!.onclick!(); assert.deepEqual(navigated, ["detail"]);
  const targets = ["part", "chapter", "detail", "other"].map((locator, index) => ({ dataset: { locator }, getBoundingClientRect: () => ({ left: index * 100, bottom: 100, top: 0 }) }));
  updateTocLocation(container as never, { querySelectorAll: () => targets } as never, { getBoundingClientRect: () => ({ left: 200, right: 300, top: 0, bottom: 100 }) } as never, true);
  assert.equal(titles[2]!.attributes["aria-current"], "location");
  assert.equal(toggles[0]!.attributes["aria-expanded"], "true"); assert.equal(toggles[1]!.attributes["aria-expanded"], "true");
  const belowViewport = [
    { dataset: { locator: "part" }, getBoundingClientRect: () => ({ left: -100, top: -50, bottom: -10 }) },
    { dataset: { locator: "chapter" }, getBoundingClientRect: () => ({ left: 10, top: 120, bottom: 140 }) },
  ];
  updateTocLocation(container as never, { querySelectorAll: () => belowViewport } as never, { getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) } as never, true);
  assert.equal(titles[0]!.attributes["aria-current"], "location");
  assert.equal(titles[1]!.attributes["aria-current"], undefined);
});
