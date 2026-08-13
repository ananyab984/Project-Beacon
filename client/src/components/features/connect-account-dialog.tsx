import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Linkedin, Mail, ExternalLink, CheckCircle2, ShieldCheck } from "lucide-react";

interface ConnectAccountDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ConnectAccountDialog({ trigger, open: controlledOpen, onOpenChange }: ConnectAccountDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);

  async function handleConnect(provider: "LINKEDIN" | "EMAIL" | "GOOGLE" | "OUTLOOK") {
    setLoadingProvider(provider);
    try {
      const res = await api.connectAccount(provider);
      if (res.url) {
        toast.success(`Opening Unipile secure connection window for ${provider}...`);
        window.open(res.url, "_blank", "width=600,height=700");
      }
    } catch (err: any) {
      toast.error(err.message || `Failed to initiate ${provider} account connection`);
    } finally {
      setLoadingProvider(null);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Connect Outreach Accounts
          </DialogTitle>
          <DialogDescription>
            Link your LinkedIn or Email account via Unipile Hosted Auth to enable real-time messaging and email tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-3">
          <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                  <Linkedin className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">LinkedIn Account</div>
                  <div className="text-xs text-muted-foreground">Send DMs & Connection Requests</div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={loadingProvider === "LINKEDIN"}
                onClick={() => handleConnect("LINKEDIN")}
                className="gap-1.5 text-xs font-medium"
              >
                {loadingProvider === "LINKEDIN" ? "Connecting..." : "Connect"}
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Email Account</div>
                  <div className="text-xs text-muted-foreground">Gmail / Google / Outlook / Mail</div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={loadingProvider === "EMAIL"}
                onClick={() => handleConnect("EMAIL")}
                className="gap-1.5 text-xs font-medium"
              >
                {loadingProvider === "EMAIL" ? "Connecting..." : "Connect"}
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
