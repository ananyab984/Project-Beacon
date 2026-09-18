/** Masks obvious PII (email addresses) and truncates long text before it
 * goes into a console.log/console.warn call -- for the handful of call sites
 * that log lead-supplied free text or identifiers for debugging. Not a
 * general-purpose PII scrubber (doesn't touch phone numbers, names, etc.) --
 * scoped to what the audit actually found logged verbatim. */
const EMAIL_PATTERN = /([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

export function redactForLog(text: string | null | undefined, maxLen = 100): string {
  if (!text) return "";
  const masked = text.replace(EMAIL_PATTERN, "$1***$2");
  if (masked.length <= maxLen) return masked;
  return `${masked.slice(0, maxLen)}...`;
}
