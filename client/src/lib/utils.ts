import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Mirrors server/src/lib/normalize.ts (validateEmailFormat) -- the server is
// the real gate; this only lets the form say "invalid" before a round trip.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw: string): boolean {
  const email = raw.trim();
  return email.length > 0 && email.length <= 254 && EMAIL_SHAPE.test(email);
}

/** The email queue's TO field: empty (falls back to the lead's own email), a
 *  LinkedIn profile URL (the LINKEDIN send path), or a valid email. */
export function isAcceptableRecipient(raw: string): boolean {
  const v = raw.trim();
  return v === "" || /^https?:\/\//i.test(v) || isValidEmail(v);
}
