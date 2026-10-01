/**
 * The one true LinkedIn connection-note character cap.
 *
 * This lived in three places with two different values, and they drifted:
 * drafting's prompt demanded "STRICTLY under 200 characters", evaluator gated
 * at 300, and unipile.service truncates at 200 before sending. Notes were
 * shipping at 206-260 chars -- over the prompt's stated limit, under the
 * enforced gate, and then silently cut at send, which drops whatever trails
 * the cut. Since the apply URL sits at the END of every note, that meant
 * losing the entire call to action.
 *
 * 200 (not 300) is deliberate: LinkedIn allows 300 on paid accounts and 200
 * on free ones, Unipile passes the limit straight through as a
 * "too_many_characters" 400, and we don't know the connected account's tier
 * at draft time. Truncating -- or better, generating -- to the conservative
 * limit means invites work on either tier. Raise this only alongside a
 * confirmed check that every sending account is on a paid plan.
 */
export const LINKEDIN_NOTE_MAX_CHARS = 200;
