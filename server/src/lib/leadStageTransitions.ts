import { prisma } from "../prisma";

/**
 * Moves a lead from NEW to CONTACTED the moment the recruiter's first
 * outbound message (either channel) actually sends successfully. "Sent and
 * delivered" in practice means "the send API call succeeded" here --
 * neither Unipile's LinkedIn messaging webhook nor its email tracking
 * webhooks (mail_opened/mail_link_clicked, see UnipileService.handleWebhookEvent)
 * expose a distinct per-channel "delivered" event to gate on instead.
 *
 * Never touches a lead already past NEW (a second, third, ... message must
 * not re-fire this). The where-guarded updateMany makes this atomic against
 * two near-simultaneous first sends (e.g. email + LinkedIn) racing each
 * other -- only whichever one actually flips the row also records the
 * StageHistory entry, so there's never a duplicate.
 *
 * Called from UnipileService.sendLinkedInMessage/sendEmail, right after
 * each records its own InteractionEvent -- best-effort, same as those
 * calls' own Conversation sync: a failure here must not undo or block a
 * message that already sent successfully.
 */
export async function markContactedOnFirstOutreach(leadId: string, recruiterId: string): Promise<void> {
  try {
    const { count } = await prisma.lead.updateMany({
      where: { id: leadId, stage: "NEW" },
      data: { stage: "CONTACTED" },
    });
    if (count > 0) {
      await prisma.stageHistory.create({
        data: { leadId, fromStage: "NEW", toStage: "CONTACTED", changedByRecruiterId: recruiterId },
      });
    }
  } catch (err: any) {
    console.warn(`Failed to move lead ${leadId} to CONTACTED after first outreach:`, err.message);
  }
}
