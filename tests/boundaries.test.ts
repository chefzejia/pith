import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { LXGW_WENKAI_LICENSE, LXGW_WENKAI_WOFF2 } from "../src/plugins/stage-reader/lxgwWenKaiData.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

test("permanent material reading state never uses the retired cache path", () => {
  const forbidden = /_cache\/reading(?:\/|["'`])/;
  assert.match('"_cache/reading/file.json"', forbidden);
  for (const file of walkTsFiles(SRC)) assert.doesNotMatch(readFileSync(file, "utf8"), forbidden, relative(ROOT, file));
});

test("embedded reader font retains its original bytes", () => {
  assert.equal(createHash("sha256").update(Buffer.from(LXGW_WENKAI_WOFF2, "base64")).digest("hex"), "ca84517aa692251360ec0124a5e9ebd1ff9720b90e785e0e1ab035ce08a97ac8");
  assert.equal(createHash("sha256").update(LXGW_WENKAI_LICENSE).digest("hex"), "5c0f0d98a8b71a401063c9a9e814e608fef6824fefab0c2ab73fe0955a5551b1");
});

test("retired toolkit terminology is absent from paths and contents", () => {
  const retired = new RegExp(["do", "jo"].join(""), "i");
  function inspect(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      assert.doesNotMatch(relative(ROOT, path), retired);
      if (entry.isDirectory()) inspect(path);
      else if (entry.isFile()) assert.doesNotMatch(readFileSync(path, "utf8"), retired, relative(ROOT, path));
    }
  }
  for (const dir of ["src", "tests", "scripts"]) inspect(join(ROOT, dir));
});

test("retired shell fragments and unused runtime parts stay removed", () => {
  for (const file of ["core/pluginrt/kernel.ts", "shells/toolkitView.ts", "shells/interlineView.ts", "shells/speechRuntime.ts", "shells/speechGateway.ts", "shells/speechSettings.ts", "shells/voiceInput.ts", "shells/mediaAssets.ts"]) {
    assert.equal(statSync(join(SRC, file), { throwIfNoEntry: false }), undefined, file);
  }
  const runtime = readFileSync(join(SRC, "core/pluginrt/runtime.ts"), "utf8");
  assert.doesNotMatch(runtime, /\b(?:PluginPart|contributedParts|getParts|contribute)\b/);
  for (const file of walkTsFiles(join(SRC, "plugins"))) {
    if (file.endsWith("/index.ts")) assert.doesNotMatch(readFileSync(file, "utf8"), /^\s*parts:\s*\[/m, file);
  }
});

test("shell root contains only the four shell directories", () => {
  const entries = readdirSync(join(SRC, "shells"), { withFileTypes: true });
  assert.deepEqual(entries.map(entry => entry.name).sort(), ["dsh", "obsidian", "speech", "web"]);
  assert.ok(entries.every(entry => entry.isDirectory()));
});

test("managed speech uses native multilingual models and ACP never reads dsh private configuration", () => {
  const forbiddenSpeech = /python3|\bpip\b|pypi\.org|vits-piper-en_US|whisper-tiny\.en/i;
  assert.match("python3 -m pip install", forbiddenSpeech);
  for (const name of ["shells/speech/speechRuntime.ts", "shells/speech/speechGateway.ts"]) assert.doesNotMatch(readFileSync(join(SRC, name), "utf8"), forbiddenSpeech);
  const privateConfig = /(?:~\/|["'`]\.\/?)\.dsh\/|cordis\.patch\.ya?ml/i;
  assert.match("~/.dsh/profiles/acp/cordis.patch.yml", privateConfig);
  for (const file of walkTsFiles(join(SRC, "plugins/guide-acp"))) assert.doesNotMatch(readFileSync(file, "utf8"), privateConfig);
});

test("the Obsidian build script resolves every path from the repository root", () => {
  const outsideRepository = /node:os|\bhomedir\b|process\.env\.HOME\b|Mobile Documents/;
  assert.match('import { homedir } from "node:os";', outsideRepository);
  assert.match('resolve(process.env.HOME, "Library/Mobile Documents")', outsideRepository);
  assert.doesNotMatch(readFileSync(join(ROOT, "scripts/build-obsidian.mjs"), "utf8"), outsideRepository);
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
  for (const [name, command] of Object.entries(scripts)) if (name !== "install:obsidian") assert.doesNotMatch(command, /install-obsidian/, name);
});

test("every test entry point loads the sandbox preload", () => {
  const preload = /--import \.\/tests\/setup\.ts(?:\s|$)/;
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts as Record<string, string>;
  const runners = Object.entries(scripts).filter(([, command]) => /\s--test(?:\s|$)/.test(command));
  assert.ok(runners.some(([name]) => name === "test"));
  for (const [name, command] of runners) assert.match(command, preload, name);
  const bareRunner = /node --experimental-strip-types --test(?:\s|$)/;
  assert.match("node --experimental-strip-types --test tests/store.test.ts", bareRunner);
  for (const file of [join(ROOT, "AGENTS.md"), join(ROOT, "README.md"), join(ROOT, "README.zh-CN.md"), ...walkMdFiles(join(ROOT, "docs"))]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), bareRunner, relative(ROOT, file));
  }
});

test("the browser test command runs every test file that launches a browser, inside the sandbox preload, and never without a browser", () => {
  const launcher = join(ROOT, "scripts/test-browser.mjs");
  assert.match(readFileSync(launcher, "utf8"), /\["--experimental-strip-types", "--import", "\.\/tests\/setup\.ts", "--test", "--test-concurrency=1"/);
  const listing = spawnSync(process.execPath, [launcher, "--list"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(listing.status, 0, listing.stderr);
  const listed = listing.stdout.trim().split("\n");
  const launching = walkTsFiles(join(ROOT, "tests")).filter(file => /\bchromium\.launch/.test(readFileSync(file, "utf8"))).map(file => relative(ROOT, file).replace(/\\/g, "/"));
  assert.ok(launching.length > 0);
  assert.deepEqual(launching.filter(file => !listed.includes(file)), []);
  const missing = spawnSync(process.execPath, [launcher], { cwd: ROOT, encoding: "utf8", env: { ...process.env, PITH_PLAYWRIGHT_MODULE: join(ROOT, "missing-playwright.mjs"), PITH_CHROME_PATH: join(ROOT, "missing-chrome") } });
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /PITH_PLAYWRIGHT_MODULE/);
  assert.match(missing.stderr, /PITH_CHROME_PATH/);
});

function walkMdFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walkMdFiles(full) : entry.isFile() && full.endsWith(".md") ? [full] : [];
  });
}

function walkTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(full)) {
      results.push(full);
    }
  }
  return results;
}

function profileWriteViolations(path: string, source: string): { violations: string[]; writes: string[] } {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [], writes: string[] = [];
  const names = new Set(["addObservation", "removeObservation"]);
  function settlementMethod(node: ts.Node): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isMethodDeclaration(parent) && parent.name.getText(file) === "execute" && ts.isObjectLiteralExpression(parent.parent)) {
        return path === "src/plugins/guide-acp/tools.ts" && parent.parent.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(file) === "name" && ts.isStringLiteral(property.initializer) && property.initializer.text === "pith_settle_topic");
      }
    }
    return false;
  }
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === "name" && ts.isStringLiteral(node.initializer) && node.initializer.text === "pith_remember") violations.push(`${path}: retired tool registered`);
    const property = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : ts.isBindingElement(node) ? (node.propertyName ?? node.name).getText(file).replace(/^['"]|['"]$/g, "") : "";
    if (names.has(property)) {
      const undo = property === "removeObservation" && path === "src/workbench/observations.ts" && (() => { for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionDeclaration(parent) && parent.name?.text === "undoTopicObservation") return true; return false; })();
      if (!settlementMethod(node) && !undo) violations.push(`${path}: ${property} outside settlement or undo`);
      else writes.push(property);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { violations, writes };
}

test("only the settlement tool accesses profile observation writes", () => {
  const path = "src/plugins/guide-acp/tools.ts";
  assert.notDeepEqual(profileWriteViolations(path, 'const tool = { name: "pith_remember", async execute() { await store.addObservation({}); } };').violations, []);
  assert.notDeepEqual(profileWriteViolations("src/other.ts", 'store["removeObservation"]("id");').violations, []);
  assert.notDeepEqual(profileWriteViolations("src/other.ts", 'const { addObservation: add } = store; add({});').violations, []);
  const results = walkTsFiles(SRC).map(file => profileWriteViolations(relative(ROOT, file).replace(/\\/g, "/"), readFileSync(file, "utf8")));
  assert.deepEqual(results.flatMap(result => result.violations), []);
  assert.deepEqual(results.flatMap(result => result.writes).sort(), ["addObservation", "removeObservation", "removeObservation"]);
});

function topicActionViolations(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), violations: string[] = [];
  const inTool = (node: ts.Node, tool: string): boolean => {
    if (path !== "src/plugins/guide-acp/tools.ts") return false;
    for (let parent = node.parent; parent; parent = parent.parent) if (ts.isMethodDeclaration(parent) && parent.name.getText(file) === "execute" && ts.isObjectLiteralExpression(parent.parent)) return parent.parent.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(file) === "name" && ts.isStringLiteral(property.initializer) && property.initializer.text === tool);
    return false;
  };
  const visit = (node: ts.Node): void => {
    const property = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : ts.isBindingElement(node) ? (node.propertyName ?? node.name).getText(file).replace(/^['"]|['"]$/g, "") : "";
    if ((property === "createTopic" || property === "updateTopic") && !ts.isTypeOfExpression(node.parent)) {
      const call = ts.isCallExpression(node.parent) && node.parent.expression === node ? node.parent : null;
      if (property === "createTopic" && (!call || !inTool(node, "pith_create_topic"))) violations.push(`${path}: createTopic outside tool`);
      if (property === "updateTopic" && !inTool(node, "pith_settle_topic")) {
        const patch = call?.arguments[1];
        if (!patch || !ts.isObjectLiteralExpression(patch) || patch.properties.some(item => {
          if (ts.isSpreadAssignment(item) || ts.isComputedPropertyName(item.name)) return true;
          const key = item.name?.getText(file).replace(/^['"]|['"]$/g, "");
          return key === "status" && (!ts.isPropertyAssignment(item) || !ts.isStringLiteral(item.initializer) || !["exploring", "shelved"].includes(item.initializer.text));
        })) violations.push(`${path}: uncontrolled topic update`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file); return violations;
}

test("topic creation and settlement are restricted to their guide tools", () => {
  assert.notDeepEqual(topicActionViolations("src/shells/example.ts", 'store.createTopic({});'), []);
  assert.notDeepEqual(topicActionViolations("src/shells/example.ts", 'store["updateTopic"]("x", { status: "settled" });'), []);
  assert.notDeepEqual(topicActionViolations("src/shells/example.ts", 'store.updateTopic("x", patch);'), []);
  assert.deepEqual(topicActionViolations("src/shells/example.ts", 'typeof store.updateTopic === "function";'), []);
  assert.deepEqual(walkTsFiles(SRC).flatMap(file => topicActionViolations(relative(ROOT, file).replace(/\\/g, "/"), readFileSync(file, "utf8"))), []);
});

test("tests never write to archived evidence", () => {
  const forbidden = [".tmp", "evidence"].join("/");
  const inspect = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap(entry => { const path = join(directory, entry.name); return entry.isDirectory() ? inspect(path) : entry.isFile() && readFileSync(path).includes(Buffer.from(forbidden)) ? [path] : []; });
  const violations = inspect(join(ROOT, "tests"));
  assert.deepEqual(violations, []);
});

function extractModuleSpecifiers(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const specs: string[] = [];
  const staticRe = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of withoutComments.matchAll(staticRe)) {
    if (match[1]) specs.push(match[1]);
  }
  for (const match of withoutComments.matchAll(dynamicRe)) {
    if (match[1]) specs.push(match[1]);
  }
  return specs;
}

test("source does not retain Base aliases for function wrappers", () => {
  const alias = /\bconst\s+[A-Za-z_$][\w$]*Base\s*=\s*[A-Za-z_$][\w$]*\s*(?:;|,|$)/gm;
  assert.match("const renderTrainingBase=renderTraining;", new RegExp(alias.source));
  assert.match("const trainingChromeBase=renderTraining;", new RegExp(alias.source));
  assert.doesNotMatch("const SettingTabBase = obsidian.PluginSettingTab || class {};", new RegExp(alias.source));
  const violations = walkTsFiles(SRC).flatMap(file => {
    const content = readFileSync(file, "utf8");
    return Array.from(content.matchAll(alias), match => `${relative(ROOT, file)}: ${match[0]}`);
  });
  assert.deepEqual(violations, []);
});

test("Web reader entry points have one definition and are never reassigned", () => {
  const content = readFileSync(join(SRC, "shells/web/client.ts"), "utf8");
  for (const name of ["home", "openTopic"]) {
    assert.equal([...content.matchAll(new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`, "g"))].length, 1, name);
    assert.doesNotMatch(content, new RegExp(`\\b${name}\\s*=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*=>)`), name);
  }
  assert.doesNotMatch(content, /stopImmediatePropagation\s*\(/);
  assert.match(content, /new WebWorkbench\(/);
  assert.match(readFileSync(join(SRC, "shells/web/workbench.ts"), "utf8"), /mountPithWorkbench\(/);
  assert.doesNotMatch(content, /class="(?:workspace|reader-wrap|training-panel)\b/);
  const server = readFileSync(join(SRC, "shells/web/server.ts"), "utf8");
  assert.doesNotMatch(server, /\.toString\s*\(/);
  assert.doesNotMatch(server, /<script\s*>/i);
});

function extractsSourceIntoVm(content: string): boolean {
  const file = ts.createSourceFile("test.ts", content, ts.ScriptTarget.Latest, true);
  const readNames = new Set(["readFile", "readFileSync"]), vmNames = new Set(["runInContext", "runInNewContext"]);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
    for (const item of statement.importClause.namedBindings.elements) {
      const original = item.propertyName?.text ?? item.name.text;
      if (readNames.has(original)) readNames.add(item.name.text);
      if (vmNames.has(original)) vmNames.add(item.name.text);
    }
  }
  let sourcePath = false, fileRead = false, vmExecution = false;
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) && !(ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && /(?:^|\/)src(?:\/|$)/.test(node.text)) sourcePath = true;
    if (ts.isCallExpression(node)) {
      const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : "";
      if (readNames.has(name)) fileRead = true;
      if (vmNames.has(name)) vmExecution = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return sourcePath && fileRead && vmExecution;
}

test("tests do not execute extracted source in a VM", () => {
  assert.equal(extractsSourceIntoVm('const s=readFile("src/example.ts"); vm.runInContext(s, context);'), true);
  assert.equal(extractsSourceIntoVm('import {readFile as read} from "node:fs/promises"; import {runInContext as run} from "node:vm"; const p="../src/example.ts"; run(read(p), context);'), true);
  assert.equal(extractsSourceIntoVm('vm.runInNewContext(readFileSync(join(root, "src", "example.js")), context);'), true);
  assert.equal(extractsSourceIntoVm('const s=readFile("src/example.ts"); assert.match(s, /rule/);'), false);
  assert.equal(extractsSourceIntoVm('const s=readFile("fixture.json"); vm.runInContext(s, context);'), false);
  const violations = walkTsFiles(join(ROOT, "tests")).filter(file => extractsSourceIntoVm(readFileSync(file, "utf8"))).map(file => relative(ROOT, file));
  assert.deepEqual(violations, []);
});

test("PluginsImportOnlyCore: core never imports plugins/shells, and plugins never import each other", () => {
  const files = walkTsFiles(SRC);
  const violations: string[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const specs = extractModuleSpecifiers(readFileSync(file, "utf8"));

    for (const spec of specs) {
      const target = spec.startsWith(".")
        ? relative(ROOT, resolve(dirname(file), spec)).replace(/\\/g, "/")
        : spec;

      // Rule 1: src/core/** never imports src/plugins/** or src/shells/**
      if (rel.startsWith("src/core/")) {
        if (target.startsWith("src/plugins/") || target.startsWith("src/workbench/") || target.startsWith("src/shells/")) {
          violations.push(`${rel} imports ${target}: core must never import plugins or shells`);
        }
      }

      if (rel === "src/plugins/all.ts" && (target.startsWith("src/workbench/") || target.startsWith("src/shells/"))) {
        violations.push(`${rel} imports ${target}: plugin registration must not import outer layers`);
      }

      // Rule 2: src/plugins/<id>/** never imports another plugin or any shell
      if (rel.startsWith("src/plugins/") && rel !== "src/plugins/all.ts") {
        const ownPlugin = rel.split("/")[2];
        if (target.startsWith("src/shells/") || target.startsWith("src/workbench/")) {
          violations.push(`${rel} imports ${target}: a plugin must never import a shell`);
        }
        if (target === "src/plugins/all.ts") {
          violations.push(`${rel} imports src/plugins/all.ts: a plugin must not import all.ts`);
        }
        if (target.startsWith("src/plugins/")) {
          const targetPlugin = target.split("/")[2];
          if (targetPlugin !== ownPlugin) {
            violations.push(`${rel} imports ${target}: a plugin never imports another plugin`);
          }
        }
      }

      if (rel.startsWith("src/workbench/") && !["src/core/", "src/plugins/", "src/workbench/"].some(layer => target.startsWith(layer))) {
        violations.push(`${rel} imports ${target}: workbench imports only its own layer, core or plugins`);
      }

      // Rule 3: Host leakage gate — only src/shells/obsidian/** may import "obsidian"
      if (spec === "obsidian" || spec.startsWith("obsidian/")) {
        if (!rel.startsWith("src/shells/obsidian/")) {
          violations.push(`${rel} imports "${spec}": only src/shells/obsidian/ may touch Obsidian`);
        }
      }
      if (spec.startsWith("@deepseek-ai/")) {
        if (!rel.startsWith("src/shells/dsh/")) {
          violations.push(`${rel} imports "${spec}": only src/shells/dsh/ may touch DSH host packages`);
        }
      }
      if (spec.startsWith("node:") || spec === "child_process" || spec === "fs" || spec === "path" || spec === "os") {
        if (!rel.startsWith("src/shells/")) {
          violations.push(`${rel} imports "${spec}": only src/shells/ may import Node host modules`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("Every plugin folder under src/plugins/ is gathered in src/plugins/all.ts", () => {
  const pluginsDir = join(SRC, "plugins");
  const allSource = readFileSync(join(pluginsDir, "all.ts"), "utf8");
  const missing: string[] = [];

  for (const entry of readdirSync(pluginsDir)) {
    const full = join(pluginsDir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (!allSource.includes(`./${entry}/index.ts`)) {
      missing.push(`src/plugins/all.ts does not import ./${entry}/index.ts`);
    }
  }

  assert.deepEqual(missing, []);
});

test("Metaphor-free Core: src/core/** contains no legacy Garden/Seed/Bloom symbol names", () => {
  const coreFiles = walkTsFiles(join(SRC, "core"));
  const forbidden = /\b(?:GardenStore|GardenerService|GardenerSidebar|SeedProposal|SourceRecord|EchoPractice)\b/;
  const hits: string[] = [];

  for (const file of coreFiles) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const withoutComments = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const match = withoutComments.match(forbidden);
    if (match) {
      hits.push(`${rel} contains legacy metaphor symbol "${match[0]}"`);
    }
  }

  assert.deepEqual(hits, []);
});

test("Zero OS-TTS & External Repo Coupling: src/** forbids browser speechSynthesis/SpeechRecognition and hardcoded external repo paths", () => {
  const files = walkTsFiles(SRC);
  const forbiddenApi = /\b(?:speechSynthesis|SpeechSynthesisUtterance|webkitSpeechRecognition|SpeechRecognition)\b/;
  const forbiddenRepo = /\b(?:ganfan-audio|Qwen3-TTS|IndexTTS)\b/;
  const hits: string[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const content = readFileSync(file, "utf8");
    const apiMatch = content.match(forbiddenApi);
    if (apiMatch) {
      hits.push(`${rel} contains forbidden OS speech API "${apiMatch[0]}"`);
    }
    const repoMatch = content.match(forbiddenRepo);
    if (repoMatch) {
      hits.push(`${rel} contains hardcoded external repo/model coupling "${repoMatch[0]}"`);
    }
  }

  assert.deepEqual(hits, []);
});

test("Documentation links in README.md, AGENTS.md, and docs/ resolve cleanly", () => {
  const docsDir = join(ROOT, "docs");
  const checkLinksIn = (filePath: string) => {
    const baseDir = dirname(filePath);
    const content = readFileSync(filePath, "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const linkRe = /\]\(([^)#]+)(?:#[^)]*)?\)/g;
    for (const match of content.matchAll(linkRe)) {
      const href = match[1]!.replace(/^<|>$/g, "");
      if (/^[a-z]+:/i.test(href)) continue;
      const resolved = resolve(baseDir, href);
      const exists = statSync(resolved, { throwIfNoEntry: false }) !== undefined;
      assert.equal(exists, true, `${relative(ROOT, filePath)} has broken local link: ${href}`);
    }
  };
  checkLinksIn(join(ROOT, "README.md"));
  checkLinksIn(join(ROOT, "README.zh-CN.md"));
  checkLinksIn(join(ROOT, "AGENTS.md"));
  for (const file of walkMdFiles(docsDir)) {
    checkLinksIn(file);
  }
});
test("batch lesson adjustment is absent from product source", () => {
  const forbidden = /\b(?:ADJUST_LESSONS_MESSAGE|adjustLessons)\b/;
  for (const file of walkTsFiles(SRC)) assert.doesNotMatch(readFileSync(file, "utf8"), forbidden, relative(SRC, file));
});
