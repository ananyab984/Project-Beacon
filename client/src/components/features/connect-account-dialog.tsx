import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Linkedin, Mail, ExternalLink, ShieldCheck, Trash2, CheckCircle2, RefreshCw } from "lucide-react";

interface ConnectAccountDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ConnectAccountDialog({ trigger, open: controlledOpen, onOpenChange }: ConnectAccountDialogProps) {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  const { data: accounts = [], refetch, isRefetching } = useQuery({
    queryKey: ["connected-accounts"],
    queryFn: () => api.getConnectedAccounts(),
    enabled: isOpen,
  });

  const disconnectMutation = useMutation({
    mutationFn: (unipileAccountId: string) => api.disconnectAccount(unipileAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connected-accounts"] });
      toast.success("Account disconnected successfully");
    },
    onError: (err: any) => toast.error(err?.message || "Failed to disconnect account"),
  });

  async function handleConnect(provider: "LINKEDIN" | "EMAIL" | "GOOGLE" | "OUTLOOK") {
    setLoadingProvider(provider);
    try {
      const res = await api.connectAccount(provider);
      if (res?.url) {
        toast.success(`Opening Unipile connection window for ${provider}…`);
        window.open(res.url, "_blank", "width=600,height=700");
      }
    } catch (err: any) {
      toast.error(err.message || `Failed to initiate ${provider} account connection`);
    } finally {
      setLoadingProvider(null);
    }
  }

  const activeAccounts = accounts.filter((a: any) => a.status !== "DISCONNECTED");
  const linkedInAccount = activeAccounts.find((a: any) => (a.provider || "").toUpperCase().includes("LINKEDIN"));
  const emailAccount = activeAccounts.find((a: any) =>
    ["EMAIL", "GOOGLE", "MAIL", "OUTLOOK"].some((p) => (a.provider || "").toUpperCase().includes(p))
  );

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" /> Connected Outreach Accounts
            </DialogTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            >
              <RefreshCw className={`h-3 w-3 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          <DialogDescription>
            Link your LinkedIn or Email accounts via Unipile Hosted Auth to send DMs & tracked emails directly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-3">
            {/* LinkedIn Account Card */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3.5 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                  <Linkedin className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">LinkedIn Account</span>
                    {linkedInAccount && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/40 text-emerald-500 font-semibold gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Connected
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate max-w-[220px]">
                    {linkedInAccount ? (linkedInAccount.accountName || linkedInAccount.unipileAccountId) : "Send DMs & Connection Requests"}
                  </div>
                </div>
              </div>

              {linkedInAccount ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate(linkedInAccount.unipileAccountId)}
                  className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1 font-medium"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingProvider === "LINKEDIN"}
                  onClick={() => handleConnect("LINKEDIN")}
                  className="gap-1.5 text-xs font-medium"
                >
                  {loadingProvider === "LINKEDIN" ? "Connecting…" : "Connect"}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {/* Email Account Card */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-3.5 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">Email Account</span>
                    {emailAccount && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-emerald-500/40 text-emerald-500 font-semibold gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Connected
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate max-w-[220px]">
                    {emailAccount ? (emailAccount.accountName || emailAccount.unipileAccountId) : "Gmail / Google / Outlook / Mail"}
                  </div>
                </div>
              </div>

              {emailAccount ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate(emailAccount.unipileAccountId)}
                  className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1 font-medium"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loadingProvider === "EMAIL"}
                  onClick={() => handleConnect("EMAIL")}
                  className="gap-1.5 text-xs font-medium"
                >
                  {loadingProvider === "EMAIL" ? "Connecting…" : "Connect"}
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
            <span>Unipile hosted-auth handles secure OAuth token exchange. Credentials are never stored locally.</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
