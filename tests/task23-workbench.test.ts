import assert from "node:assert/strict";
import test from "node:test";
import { mountPithWorkbench, PithWorkbenchView, workbenchStyles } from "../src/workbench/index.ts";
import * as dsh from "../src/shells/dsh/index.ts";
import { PithObsidianView, obsidianStyles } from "../src/shells/obsidian/plugin.ts";

test("DSH and Obsidian expose the same workbench implementations", () => {
  assert.equal(dsh.mountPithWorkbench, mountPithWorkbench);
  assert.equal(dsh.PithWorkbenchView, PithWorkbenchView);
  assert.equal(dsh.workbenchStyles, workbenchStyles);
  assert.equal(PithObsidianView, PithWorkbenchView);
  assert.equal(obsidianStyles, workbenchStyles);
});
