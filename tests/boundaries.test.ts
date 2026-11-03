import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

function walkTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.isFile() && full.endsWith(".ts")) {
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

test("Ordered docs in docs/ resolve local links and never depend forward", () => {
  const docsDir = join(ROOT, "docs");
  const docFiles = readdirSync(docsDir)
    .filter((f) => /^\d{3}-.*\.md$/.test(f))
    .sort();

  for (const file of docFiles) {
    const num = Number.parseInt(file.slice(0, 3), 10);
    const content = readFileSync(join(docsDir, file), "utf8");
    const linkRe = /\]\(([^)#]+)(?:#[^)]*)?\)/g;
    for (const match of content.matchAll(linkRe)) {
      const href = match[1]!;
      if (/^[a-z]+:/i.test(href)) continue;
      const resolved = resolve(docsDir, href);
      assert.equal(
        statSync(resolved, { throwIfNoEntry: false })?.isFile() ?? false,
        true,
        `docs/${file} has broken local link: ${href}`,
      );
      const targetBase = relative(docsDir, resolved);
      if (/^\d{3}-.*\.md$/.test(targetBase)) {
        const targetNum = Number.parseInt(targetBase.slice(0, 3), 10);
        assert.equal(
          targetNum <= num,
          true,
          `docs/${file} links forward to later document ${targetBase}`,
        );
      }
    }
  }
});
