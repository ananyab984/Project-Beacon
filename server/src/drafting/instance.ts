/** Singleton DraftingOrchestrator, constructed once at first use rather than
 * per-request (matching the Python service's single module-level
 * orchestrator instance in main.py's run_server()). */

import { loadDraftingConfig } from "./config";
import { DraftingOrchestrator } from "./orchestrator";

let instance: DraftingOrchestrator | null = null;

export function getDraftingOrchestrator(): DraftingOrchestrator {
  if (!instance) {
    instance = new DraftingOrchestrator(loadDraftingConfig());
  }
  return instance;
}
