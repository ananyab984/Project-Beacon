/** Recruiter edit logging & similarity metric calculator.
 * Direct port of drafting_service/core/edit_logger.py. Exported as a plain
 * function, not wired to a route -- POST /draft/edit-log had zero live
 * callers when this was ported (confirmed via repo-wide grep); this stays
 * available for a future recruiter-edit-tracking feature to call directly. */

import { sequenceMatcherRatio } from "./lib/sequenceMatcher";

export interface EditLogResult {
  draft_id: string;
  original_length: number;
  edited_length: number;
  similarity_score: number;
  edit_percentage: number;
  was_edited: boolean;
}

export function logRecruiterEdit(draftId: string, originalBody: string, editedBody: string): EditLogResult {
  const orig = originalBody || "";
  const edited = editedBody || "";

  const similarity = sequenceMatcherRatio(orig, edited);
  const editPct = Math.round((1.0 - similarity) * 100 * 100) / 100;

  return {
    draft_id: draftId,
    original_length: orig.length,
    edited_length: edited.length,
    similarity_score: Math.round(similarity * 10000) / 10000,
    edit_percentage: editPct,
    was_edited: editPct > 0.0,
  };
}
