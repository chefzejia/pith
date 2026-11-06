import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

test("managed speech uses native multilingual models and ACP never reads dsh private configuration", () => {
  const forbiddenSpeech = /python3|\bpip\b|pypi\.org|vits-piper-en_US|whisper-tiny\.en/i;
  assert.match("python3 -m pip install", forbiddenSpeech);
  for (const name of ["shells/speechRuntime.ts", "shells/speechGateway.ts"]) assert.doesNotMatch(readFileSync(join(SRC, name), "utf8"), forbiddenSpeech);
  const privateConfig = /(?:~\/|["'`]\.\/?)\.dsh\/|cordis\.patch\.ya?ml/i;
  assert.match("~/.dsh/profiles/acp/cordis.patch.yml", privateConfig);
  for (const file of walkTsFiles(join(SRC, "plugins/guide-acp"))) assert.doesNotMatch(readFileSync(file, "utf8"), privateConfig);
});

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
  const content = readFileSync(join(SRC, "shells/web/server.ts"), "utf8");
  for (const name of ["renderTraining", "home", "workspace", "openTopic", "startSpeech"]) {
    assert.equal([...content.matchAll(new RegExp(`\\b(?:async\\s+)?function\\s+${name}\\s*\\(`, "g"))].length, 1, name);
    assert.doesNotMatch(content, new RegExp(`\\b${name}\\s*=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*=>)`), name);
  }
  assert.doesNotMatch(content, /stopImmediatePropagation\s*\(/);
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
        if (target.startsWith("src/plugins/") || target.startsWith("src/shells/")) {
          violations.push(`${rel} imports ${target}: core must never import plugins or shells`);
        }
      }

      // Rule 2: src/plugins/<id>/** never imports another plugin or any shell
      if (rel.startsWith("src/plugins/") && rel !== "src/plugins/all.ts") {
        const ownPlugin = rel.split("/")[2];
        if (target.startsWith("src/shells/")) {
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
  const walkMdFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? walkMdFiles(full) : entry.isFile() && full.endsWith(".md") ? [full] : [];
    });
  for (const file of walkMdFiles(docsDir)) {
    checkLinksIn(file);
  }
});
