/**
 * Single canonical, alphabetized service list -- shared by every dialog that
 * lets someone pick a service (Client Demand, Add a Lead, Contractor Add a
 * Lead, Manual Enrichment) and by the Leads page's service filter. Reconciles
 * what were previously 3 independent, differently-worded lists (client-demand
 * -dialog's STANDARD_SERVICES, add-lead-dialog's/contractor-add-lead-dialog's
 * SERVICES, and manual-enrichment-dialog's inline array) into one set, using
 * each list's short canonical form (e.g. "SDH" not "SDH (Subtitles for Deaf
 * & Hard of Hearing)", "Voice Over" not "Voiceover"/"QA").
 */
export const STANDARD_SERVICES = [
  "AI Post-editing",
  "Audio Description",
  "CC",
  "Conform",
  "Dubbing",
  "Interpretation",
  "Localization QA",
  "Prelude",
  "Quality Control",
  "SDH",
  "Scripting",
  "Subtitling",
  "Transcreation",
  "Transcription",
  "Translation",
  "Voice Over",
];
