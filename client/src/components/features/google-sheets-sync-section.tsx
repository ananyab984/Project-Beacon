import { useRef, useState } from "react";
import { Upload, RefreshCw, LinkIcon, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  syncFromGoogleSheet,
  getSheetSyncState,
  setSheetUrl,
  addClientDemand,
  addRequirement,
  parseCsvClientDemands,
  type ClientDemand,
} from "@/lib/g3-mock";

/**
 * Client-intake import panel: sync demands from a configured Google Sheet, or
 * upload a CSV/Excel file. Both paths write into the shared client-demand mock
 * store. Rendered inside {@link ClientDemandDialog}.
 */
export function GoogleSheetsSyncSection() {
  const [syncing, setSyncing] = useState(false);
  const [state, setState] = useState(getSheetSyncState());
  const [inputUrl, setInputUrl] = useState(state.sheetUrl);
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncFromGoogleSheet();
      toast.success(`Sheet sync complete! Loaded ${res.added + res.updated} demands.`);
      setState(getSheetSyncState());
    } catch (e: any) {
      toast.error(e.message || "Failed to sync Google Sheet");
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveUrl = () => {
    if (!inputUrl.trim()) {
      toast.error("Please enter a valid Google Sheets URL");
      return;
    }
    setSheetUrl(inputUrl.trim());
    setState(getSheetSyncState());
    setEditing(false);
    toast.success("Google Sheet URL saved.");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || "";
      const parsed = parseCsvClientDemands(text);
      if (parsed.length > 0) {
        parsed.forEach((d: Omit<ClientDemand, "id">) => {
          addClientDemand(d);
        });
        toast.success(`Uploaded ${file.name}! Imported ${parsed.length} client demand records.`);
      } else {
        toast.info(`Uploaded ${file.name}. Please ensure file contains Client, Language, Service, and Headcount headers.`);
      }
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

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
              onClick={handleSync}
              disabled={syncing}
              size="sm"
              className="h-7 px-2.5 gap-1.5 text-[11px] font-semibold bg-primary text-primary-foreground"
            >
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {syncing ? "Syncing..." : "Sync Sheet"}
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
                {state.sheetUrl}
              </span>
            )}

            {editing ? (
              <div className="flex items-center gap-1 shrink-0">
                <Button type="button" size="sm" onClick={handleSaveUrl} className="h-6 px-2 text-[10px]">Save</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} className="h-6 px-1 text-[10px]">Cancel</Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setEditing(true)}
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

      {state.lastSynced && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5 px-1">
          <span className="flex items-center gap-1 text-accent font-medium">
            <CheckCircle2 className="h-3 w-3" /> Last synced {new Date(state.lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}
    </div>
  );
}
