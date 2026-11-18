import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ledger = readFileSync(join(ROOT, "docs/FEATURES.md"), "utf8");
const tasks = readFileSync(join(ROOT, "docs/TASKS.md"), "utf8");
const featureHeader = "| ID | 用户能做什么 | 状态 | Web / Obsidian | 最近独立验收 | 已知缺口 |";
type Feature = { id: string; state: string; hosts: string; acceptance: string };

function section(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.indexOf(`## ${title}`);
  assert.notEqual(start, -1, `missing section: ${title}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function tables(markdown: string): string[][] {
  const result: string[][] = [];
  let current: string[] = [];
  for (const line of [...markdown.split(/\r?\n/), ""]) {
    if (line.trim().startsWith("|")) current.push(line.trim());
    else if (current.length) { result.push(current); current = []; }
  }
  assert.ok(result.length > 0, "section must contain a table");
  return result;
}

function cells(line: string): string[] {
  assert.ok(line.startsWith("|") && line.endsWith("|"), `invalid table row: ${line}`);
  return line.slice(1, -1).split(/(?<!\\)\|/).map(cell => cell.trim());
}

function rows(table: string[], header: string): string[][] {
  assert.equal(table[0], header, "table header differs from the ledger contract");
  const width = cells(header).length;
  assert.ok(table[1], "table must have an alignment row");
  const alignment = cells(table[1]);
  assert.equal(alignment.length, width);
  assert.ok(alignment.every(cell => /^:?-+:?$/.test(cell)), "invalid table alignment");
  assert.ok(table.length > 2, "table must contain feature rows");
  return table.slice(2).map(line => {
    const row = cells(line);
    assert.equal(row.length, width, `wrong column count: ${line}`);
    return row;
  });
}

function features(): Feature[] {
  return tables(section(ledger, "功能清单")).flatMap(table => rows(table, featureHeader)).map(row => ({
    id: row[0]!, state: row[2]!, hosts: row[3]!, acceptance: row[4]!,
  }));
}

function uniqueIds(ids: string[], label: string): void {
  for (const id of ids) assert.match(id, /^F-[A-Z]+(?:-[A-Z]+)*$/, `${label}: invalid feature ID ${id}`);
  assert.equal(new Set(ids).size, ids.length, `${label}: duplicate feature ID`);
}

function git(...args: string[]): string {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const history = new Set(git("rev-list", "--all").split("\n"));
const commits = new Map<string, string>();
function commitInHistory(ref: string): string {
  assert.match(ref, /^[0-9a-f]{7,40}$/, `invalid commit: ${ref}`);
  let commit = commits.get(ref);
  if (!commit) {
    commit = git("rev-parse", "--verify", `${ref}^{commit}`);
    assert.ok(history.has(commit), `commit is outside repository history: ${ref}`);
    commits.set(ref, commit);
  }
  return commit;
}

function acceptanceCommit(feature: Feature): string {
  const match = /#\d+ @([0-9a-f]{7})(?![0-9a-z])/.exec(feature.acceptance);
  assert.ok(match, `${feature.id}: acceptance must contain #<id> @7-character-commit`);
  return commitInHistory(match[1]!);
}

function checkTaskFeatures(markdown: string, known = new Map(features().map(feature => [feature.id, feature]))): void {
  const blocks = [...markdown.matchAll(/^## \[Milestone #(\d+)\][^\n]*\n([\s\S]*?)(?=^## \[Milestone #|$(?![\s\S]))/gm)];
  assert.ok(blocks.length > 0, "TASKS must contain milestone blocks");
  for (const block of blocks) {
    const body = block[2]!;
    const field = (name: string) => new RegExp(`^- \\*\\*${name}\\*\\*:[ \\t]*(.*)$`, "m").exec(body)?.[1]?.trim();
    const listed = field("Features");
    if (listed === undefined || listed === "—") continue;
    assert.ok(listed, `#${block[1]}: empty Features field`);
    for (const id of listed.split(/[、,，\s]+/)) {
      const feature = known.get(id);
      assert.ok(feature, `#${block[1]}: unknown feature ${id}`);
      if (field("Status") !== "verified") continue;
      const verified = field("Verified-Commit");
      assert.ok(verified, `#${block[1]}: verified milestone has no Verified-Commit`);
      if (feature.state === "待复验") continue;
      const accepted = acceptanceCommit(feature);
      const ancestor = spawnSync("git", ["-C", ROOT, "merge-base", "--is-ancestor", commitInHistory(verified), accepted], { encoding: "utf8" });
      assert.equal(ancestor.status, 0, `#${block[1]} ${id}: acceptance ${feature.acceptance} predates or diverges from Verified-Commit ${verified}; ${ancestor.stderr}`);
    }
  }
}

test("feature ledger tables have the exact schema and globally unique IDs", () => {
  uniqueIds(features().map(feature => feature.id), "feature list");
});

test("feature ledger states and host coverage use the declared vocabulary", () => {
  for (const feature of features()) {
    assert.ok(["已验收", "待复验", "契约"].includes(feature.state), `${feature.id}: invalid state ${feature.state}`);
    assert.match(feature.hosts, /^[✓○–] \/ [✓○–]$/, `${feature.id}: invalid host coverage ${feature.hosts}`);
  }
});

test("accepted features name an independently covered host and a real acceptance commit", () => {
  for (const feature of features().filter(feature => feature.state === "已验收")) {
    assert.ok(feature.hosts.includes("✓"), `${feature.id}: accepted without an independently covered host`);
    acceptanceCommit(feature);
  }
});

test("regression rows exactly cover feature IDs and link tests unless contract-only", () => {
  const regression = tables(section(ledger, "回归测试")).flatMap(table => rows(table, "| ID | 测试 |"));
  uniqueIds(regression.map(row => row[0]!), "regression list");
  const all = features();
  assert.deepEqual(regression.map(row => row[0]!).sort(), all.map(feature => feature.id).sort(), "regression IDs must exactly match feature IDs");
  const states = new Map(all.map(feature => [feature.id, feature.state]));
  for (const [id, links] of regression) {
    if (states.get(id!) === "契约" && links === "—") continue;
    assert.match(links!, /\[[^\]]+\]\(\.\.\/tests\/[^\s)]+\)/, `${id}: needs at least one test link`);
  }
});

test("every subsystem file is linked from the architecture map", () => {
  const architecture = join(ROOT, "docs/ARCHITECTURE.md");
  const links = new Set([...readFileSync(architecture, "utf8").replace(/<!--[\s\S]*?-->/g, "").matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)]
    .map(match => resolve(dirname(architecture), match[1]!.replace(/^<|>$/g, ""))));
  function check(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) check(path);
      else assert.ok(links.has(path), `unlinked subsystem file: ${relative(ROOT, path)}`);
    }
  }
  check(join(ROOT, "docs/subsystems"));
});

test("milestone features exist and verified acceptance never predates the milestone commit", () => {
  checkTaskFeatures(tasks);
});

test("verified feature ancestry accepts equal and descendant commits using the release ledger", () => {
  // #54 predates Features fields; these synthetic blocks exercise both ancestry cases against its real ledger row and Git history.
  for (const verified of ["0751ce185f144694fe3e6d52c9dd57a810a06c35", "908aa0f9ad9bfb68941f09fdd3e4e49901edfee5"]) {
    checkTaskFeatures(`## [Milestone #54] release ancestry control\n- **Status**: verified\n- **Verified-Commit**: ${verified}\n- **Features**: F-OFFLINE\n`);
  }
});

function syntheticVerifiedTask(feature: Feature, verified: string): string {
  return [
    "## [Milestone #60] synthetic ledger regression",
    "- **Status**: verified",
    `- **Verified-Commit**: ${verified}`,
    `- **Features**: ${feature.id}`,
    "",
  ].join("\n");
}

test("verified milestones allow pending features without an acceptance SHA", () => {
  const pending: Feature = { id: "F-TEST-PENDING", state: "待复验", hosts: "○ / ○", acceptance: "无" };
  const known = new Map([[pending.id, pending]]);
  checkTaskFeatures(syntheticVerifiedTask(pending, git("rev-parse", "HEAD")), known);
});

test("verified milestones require accepted features to have a valid descendant acceptance commit", () => {
  const [newer, older] = git("rev-list", "--max-count=2", "HEAD").split("\n");
  assert.ok(newer && older, "test requires two commits in repository history");
  const accepted = (acceptance: string): Feature => ({
    id: "F-TEST-ACCEPTED", state: "已验收", hosts: "✓ / ○", acceptance,
  });
  const invalid = accepted("#60 @not-a-commit（11-18）");
  assert.throws(() => checkTaskFeatures(syntheticVerifiedTask(invalid, newer), new Map([[invalid.id, invalid]])), /acceptance must contain/);

  const predating = accepted(`#60 @${older.slice(0, 7)}（11-18）`);
  assert.throws(() => checkTaskFeatures(syntheticVerifiedTask(predating, newer), new Map([[predating.id, predating]])), /predates or diverges/);

  const descendant = accepted(`#60 @${newer.slice(0, 7)}（11-18）`);
  checkTaskFeatures(syntheticVerifiedTask(descendant, older), new Map([[descendant.id, descendant]]));
});
