import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Linkedin, Mail, Send, ShieldCheck, CheckCircle2 } from "lucide-react";

interface SelectAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: any[];
  channel: "EMAIL" | "LINKEDIN";
  onSelectAccount: (accountId: string) => void;
  isSending?: boolean;
}

export function SelectAccountDialog({
  open,
  onOpenChange,
  accounts,
  channel,
  onSelectAccount,
  isSending = false,
}: SelectAccountDialogProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.unipileAccountId || "");

  const handleConfirm = () => {
    if (!selectedAccountId) return;
    onSelectAccount(selectedAccountId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" /> Select Outreach Account
          </DialogTitle>
          <DialogDescription>
            You have multiple connected {channel === "EMAIL" ? "Email" : "LinkedIn"} accounts. Select which account to send this outreach message from.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-3">
          {accounts.map((acc) => {
            const isSelected = (selectedAccountId || accounts[0]?.unipileAccountId) === acc.unipileAccountId;
            return (
              <div
                key={acc.id || acc.unipileAccountId}
                onClick={() => setSelectedAccountId(acc.unipileAccountId)}
                className={`flex items-center justify-between cursor-pointer rounded-xl border p-3.5 transition-colors ${
                  isSelected ? "border-primary bg-primary/5 shadow-xs" : "border-border bg-card hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-3">
                  {channel === "LINKEDIN" ? (
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                      <Linkedin className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                      <Mail className="h-4 w-4" />
                    </div>
                  )}
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {acc.accountName || acc.unipileAccountId}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-emerald-500/40 text-emerald-500">
                        {acc.status || "CONNECTED"}
                      </Badge>
                      <span>• {acc.provider}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isSelected && <CheckCircle2 className="h-5 w-5 text-primary" />}
                </div>
              </div>
            );
          })}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!selectedAccountId && accounts.length === 0}
              onClick={handleConfirm}
              className="text-xs bg-primary text-primary-foreground font-semibold gap-1.5"
            >
              <Send className="h-3.5 w-3.5" /> {isSending ? "Sending…" : "Send Message"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
