/** Rate Card lookup and grounding verification module.
 * Direct port of drafting_service/core/rate_card.py — keep in sync by eye. */

export interface RateCardRow {
  source_language: string;
  target_language: string;
  service: string;
  rate: number;
  unit: string;
  currency: string;
}

export const DEFAULT_RATE_CARD: RateCardRow[] = [
  { source_language: "English", target_language: "German", service: "Translation", rate: 0.12, unit: "per word", currency: "USD" },
  { source_language: "English", target_language: "Spanish", service: "Translation", rate: 0.1, unit: "per word", currency: "USD" },
  { source_language: "English", target_language: "French", service: "Translation", rate: 0.11, unit: "per word", currency: "USD" },
  { source_language: "English", target_language: "Japanese", service: "Translation", rate: 0.15, unit: "per word", currency: "USD" },
  { source_language: "Spanish", target_language: "English", service: "Audio Description", rate: 0.14, unit: "per word", currency: "USD" },
  { source_language: "English", target_language: "English", service: "Audio Description", rate: 0.13, unit: "per word", currency: "USD" },
];

export class RateCardService {
  private rateCard: RateCardRow[];

  constructor(rateCard?: RateCardRow[] | null) {
    this.rateCard = rateCard && rateCard.length ? rateCard : DEFAULT_RATE_CARD;
  }

  lookupRate(
    sourceLang?: string | null,
    targetLang?: string | null,
    service?: string | null
  ): [RateCardRow | null, string | null] {
    const src = (sourceLang || "").trim().toLowerCase();
    const tgt = (targetLang || "").trim().toLowerCase();

    if (!src && !tgt) return [null, "NO_RATE_MATCH"];

    for (const row of this.rateCard) {
      const rSrc = (row.source_language || "").trim().toLowerCase();
      const rTgt = (row.target_language || "").trim().toLowerCase();
      if ((rSrc === src || !src) && (rTgt === tgt || !tgt)) {
        return [row, null];
      }
    }

    return [null, "NO_RATE_MATCH"];
  }
}
