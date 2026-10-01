import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * One Email toggle and one Slack toggle for every notification type this
 * user's role gets, plus the Slack Member ID field the Slack toggle depends
 * on. Each toggle fans out to every type's own preference row server-side
 * (bulk PATCH /notifications/preferences) -- the schema and send-time checks
 * in notification.service.ts stay per-type, only the UI is collapsed.
 *
 * Shared by all three settings pages. The per-type table this replaced on
 * recruiter.settings.tsx carried a hand-maintained label map that silently
 * rendered blank rows once RECRUITER_TYPES grew past the 5 types it covered;
 * there's no per-type row here, so there's nothing to keep in sync.
 *
 * Callers supply their own section container (each page's is different) and
 * `desc`, which names that role's always-on bell types.
 */
export function NotificationChannelPrefs({ desc }: { desc: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: prefsData } = useQuery({
    queryKey: ["notification-preferences"],
    queryFn: api.getNotificationPreferences,
  });

  const updateAllMutation = useMutation({
    mutationFn: (patch: { emailEnabled?: boolean; slackEnabled?: boolean }) =>
      api.updateAllNotificationPreferences(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-preferences"] }),
    onError: (err: any) => toast.error(err?.message || "Failed to update notification preferences"),
  });

  const [slackMemberId, setSlackMemberId] = useState(user?.slackMemberId ?? "");
  const slackMutation = useMutation({
    mutationFn: () => api.updateSlackMemberId(user!.id, slackMemberId.trim() || null),
    onSuccess: () => toast.success("Slack member ID saved"),
    onError: (err: any) => toast.error(err?.message || "Failed to save Slack member ID"),
  });

  const preferences = prefsData?.preferences ?? [];
  // "On" only once every type actually has that channel enabled -- a mixed
  // state (e.g. one type toggled on some other way) reads as off rather than
  // silently claiming a partial state is fully on.
  const emailOn = preferences.length > 0 && preferences.every((p) => p.emailEnabled);
  const slackOn = preferences.length > 0 && preferences.every((p) => p.slackEnabled);

  return (
    <>
      <p className="text-xs text-muted-foreground">{desc}</p>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
          <div>
            <div className="text-xs font-semibold text-foreground">Email notifications</div>
            <div className="text-[11px] text-muted-foreground">
              Send all of the above to your work email too.
            </div>
          </div>
          <Switch
            checked={emailOn}
            disabled={updateAllMutation.isPending}
            onCheckedChange={(checked) => updateAllMutation.mutate({ emailEnabled: checked })}
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 px-4 py-3">
          <div>
            <div className="text-xs font-semibold text-foreground">Slack notifications</div>
            <div className="text-[11px] text-muted-foreground">
              Send all of the above as a Slack DM too (needs your Slack Member ID below).
            </div>
          </div>
          <Switch
            checked={slackOn}
            disabled={updateAllMutation.isPending}
            onCheckedChange={(checked) => updateAllMutation.mutate({ slackEnabled: checked })}
          />
        </div>
      </div>

      <div className="mt-4 space-y-1.5 border-t border-border pt-4">
        <Label className="text-xs">Slack Member ID</Label>
        <p className="text-[11px] text-muted-foreground">
          Copy your member ID from your Slack profile and paste it here to receive Slack
          notifications.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={slackMemberId}
            onChange={(e) => setSlackMemberId(e.target.value)}
            placeholder="U0XXXXXXX"
            className="text-xs max-w-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={slackMutation.isPending}
            onClick={() => slackMutation.mutate()}
            className="text-xs"
          >
            Save
          </Button>
        </div>
      </div>
    </>
  );
}
