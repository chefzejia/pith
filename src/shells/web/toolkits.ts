import type { ToolkitDescriptor } from "../../core/index.ts";
import { feynmanToolkit } from "../../plugins/toolkit-feynman/index.ts";
import { shadowingToolkit } from "../../plugins/toolkit-shadowing/index.ts";
import { interlineToolkit } from "../../plugins/toolkit-interline/index.ts";

/** Registration metadata stays available before a toolkit is mounted. */
export const toolkitCatalog: readonly ToolkitDescriptor[] = [feynmanToolkit, shadowingToolkit, interlineToolkit];
export const trainingToolkits = toolkitCatalog.filter(toolkit => toolkit.role === "training");
