/**
 * Registers every built-in Pith plugin (modeled after magpie's `plugins/all/all.go`).
 *
 * Only shell entrypoints (`src/shells/*`) and tests import this module:
 * - `src/core/` never imports a plugin;
 * - a plugin never imports another plugin.
 */

import "./toolkit-feynman/index.ts";
import "./toolkit-interline/index.ts";
import "./toolkit-shadowing/index.ts";
import "./guide-acp/index.ts";
import "./speech-service/index.ts";
import "./stage-reader/index.ts";
import "./stage-timeline/index.ts";

export { builtinRegistry } from "../core/index.ts";
