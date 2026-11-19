import "../src/plugins/all.ts";
export { createScopedTools } from "../src/plugins/guide-acp/tools.ts";
export { feynmanToolkit } from "../src/plugins/toolkit-feynman/index.ts";
export { intakeMaterialFixture } from "./task66-intake-fixture.ts";
import { feynmanToolkit } from "../src/plugins/toolkit-feynman/index.ts";
import { shadowingToolkit } from "../src/plugins/toolkit-shadowing/index.ts";
import { interlineToolkit } from "../src/plugins/toolkit-interline/index.ts";
export const testToolkits = [feynmanToolkit, shadowingToolkit, interlineToolkit];
