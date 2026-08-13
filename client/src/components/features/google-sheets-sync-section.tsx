import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, RefreshCw, LinkIcon, CheckCircle2, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { parseCsvClientDemands, type ClientDemand } from "@/lib/g3-mock";

/**
 * Client-intake import panel: sync demands from a configured Google Sheet, or
 * upload a CSV/Excel file. Rendered inside {@link ClientDemandDialog}.
 *
 * Google Sheets sync is backed by the real API. `triggerSheetSync` is an
 * honest stub server-side today — it always returns `{ synced: false, reason }`
 * — so we surface that reason to the user instead of pretending it succeeded.
 */
export function GoogleSheetsSyncSection() {
  const queryClient = useQueryClient();
  const { data: syncConfig } = useQuery({ queryKey: ["sheet-sync"], queryFn: () => api.getSheetSync() });

  const [inputUrl, setInputUrl] = useState("");
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const saveUrlMutation = useMutation({
    mutationFn: (url: string) => api.setSheetSyncUrl(url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sheet-sync"] });
      setEditing(false);
      toast.success("Google Sheet URL saved.");
    },
    onError: (e: any) => toast.error(e.message || "Failed to save Google Sheet URL"),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.triggerSheetSync(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["sheet-sync"] });
      if (res.synced) {
        toast.success("Sheet sync complete.");
        setLastSyncMessage(null);
      } else {
        // Honest stub — don't claim a sync happened.
        const reason = res.reason || "Google Sheets sync is not configured yet";
        setLastSyncMessage(reason);
        toast.info(reason);
      }
    },
    onError: (e: any) => toast.error(e.message || "Failed to sync Google Sheet"),
  });

  const handleSaveUrl = () => {
    if (!inputUrl.trim()) {
      toast.error("Please enter a valid Google Sheets URL");
      return;
    }
    saveUrlMutation.mutate(inputUrl.trim());
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = (event.target?.result as string) || "";
      const parsed = parseCsvClientDemands(text);
      if (parsed.length === 0) {
        toast.info(`Uploaded ${file.name}. Please ensure file contains Client, Language, Service, and Headcount headers.`);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      let created = 0;
      let failed = 0;
      for (const d of parsed as Omit<ClientDemand, "id">[]) {
        try {
          await api.createClientDemand({
            clientName: d.client,
            language: d.language,
            services: d.service_breakdown.map((s) => ({ service: s.service, needed: s.needed })),
            priority: d.priority.toUpperCase(),
            deadline: d.deadline || undefined,
            contactName: d.contact_name || undefined,
            contactEmail: d.contact_email || undefined,
            notes: d.notes || undefined,
          });
          created += 1;
        } catch {
          failed += 1;
        }
      }

      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["requirements"] });
      queryClient.invalidateQueries({ queryKey: ["client-demands"] });

      if (created > 0) {
        toast.success(`Uploaded ${file.name}! Imported ${created} client demand record(s)${failed ? `, ${failed} failed` : ""}.`);
      } else {
        toast.error(`Uploaded ${file.name}, but no records could be imported.`);
      }

      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const sheetUrl = syncConfig?.sheetUrl ?? null;
  const lastSyncedAt = syncConfig?.lastSyncedAt ?? null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4">
      {/* Import Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary">
            <Upload className="h-4 w-4" />
          </span>
          <div>
            <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <span>Import Client Intake Demands</span>
              <span className="rounded-full bg-accent/20 px-2 py-0.2 text-[10px] font-semibold text-accent">
                Live Integration &amp; File Upload
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Sync directly from Google Sheets or upload CSV / Excel spreadsheet files (.csv, .xlsx, .xls).
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Google Sheets Sync Card */}
        <div className="rounded-lg border border-border/80 bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <LinkIcon className="h-3.5 w-3.5 text-primary" />
              <span>Google Sheets Sync</span>
            </div>
            <Button
              type="button"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              size="sm"
              className="h-7 px-2.5 gap-1.5 text-[11px] font-semibold bg-primary text-primary-foreground"
            >
              {syncMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {syncMutation.isPending ? "Syncing..." : "Sync Sheet"}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-1 text-[11px] bg-muted/20 p-1.5 rounded border border-border/50">
            {editing ? (
              <Input
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                className="h-6 text-[11px] bg-background flex-1"
                autoFocus
              />
            ) : (
              <span className="text-muted-foreground truncate font-mono text-[10px] flex-1">
                {sheetUrl || "No sheet URL configured"}
              </span>
            )}

            {editing ? (
              <div className="flex items-center gap-1 shrink-0">
                <Button type="button" size="sm" onClick={handleSaveUrl} disabled={saveUrlMutation.isPending} className="h-6 px-2 text-[10px]">Save</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} className="h-6 px-1 text-[10px]">Cancel</Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => { setInputUrl(sheetUrl ?? ""); setEditing(true); }}
                className="h-auto p-0 text-[10px] font-medium text-accent hover:underline shrink-0"
              >
                Change URL
              </Button>
            )}
          </div>
        </div>

        {/* Upload CSV & Excel File Card */}
        <div className="rounded-lg border border-border/80 bg-card p-3 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Upload className="h-3.5 w-3.5 text-accent" />
              <span>CSV / Excel Upload</span>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">.csv, .xlsx, .xls</span>
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".csv, .xlsx, .xls, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
            className="hidden"
          />

          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full h-7 gap-1.5 text-[11px] font-semibold bg-background border-dashed border-accent/40 text-accent hover:bg-accent/10"
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {uploading ? "Uploading file..." : "+ Upload CSV or Excel File"}
          </Button>
        </div>
      </div>

      {lastSyncMessage && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-0.5 px-1">
          <Info className="h-3 w-3 shrink-0" /> {lastSyncMessage}
        </div>
      )}

      {!lastSyncMessage && lastSyncedAt && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5 px-1">
          <span className="flex items-center gap-1 text-accent font-medium">
            <CheckCircle2 className="h-3 w-3" /> Last synced {new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      )}
    </div>
  );
}
