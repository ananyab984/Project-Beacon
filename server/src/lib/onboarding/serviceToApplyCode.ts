/**
 * Maps our internal service labels (client/src/lib/services.ts's
 * STANDARD_SERVICES) to the `service` enum G3's apply form expects:
 * scr | sub | sdh | cc | dub | ad | others.
 *
 * Per the confirmed contract, "others" is a real, always-valid slot -- so
 * unlike the country/language mappers above, this one never returns
 * undefined for a non-empty input: anything we don't have an explicit code
 * for still falls into "others" rather than being silently dropped. The
 * `service` param is only omitted upstream (in buildApplyUrl) when the lead
 * has no service value at all.
 */
export type ApplyServiceCode = "scr" | "sub" | "sdh" | "cc" | "dub" | "ad" | "others";

const SERVICE_LABEL_TO_APPLY_CODE: Record<string, ApplyServiceCode> = {
  "scripting": "scr",
  "subtitling": "sub",
  "sdh": "sdh",
  "cc": "cc",
  "dubbing": "dub",
  "audio description": "ad",
  // Everything else in STANDARD_SERVICES has no dedicated slot in G3's
  // enum -- explicit here (rather than left to the "anything else"
  // fallback below) so a future addition to either list doesn't silently
  // change behavior without someone noticing this file.
  "ai post-editing": "others",
  "conform": "others",
  "interpretation": "others",
  "localization qa": "others",
  "prelude": "others",
  "quality control": "others",
  "transcreation": "others",
  "transcription": "others",
  "translation": "others",
  "voice over": "others",
};

export function serviceToApplyCode(service: string | null | undefined): ApplyServiceCode | undefined {
  if (!service) return undefined;
  const key = service.trim().toLowerCase();
  if (!key) return undefined;
  return SERVICE_LABEL_TO_APPLY_CODE[key] ?? "others";
}

// Exported for tests / debugging -- callers should use serviceToApplyCode().
export { SERVICE_LABEL_TO_APPLY_CODE };
