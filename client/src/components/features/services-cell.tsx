import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { X } from "lucide-react";

/** Services table cell: a single compact button that opens the full list in
 *  a popover, each with its own delete-X. A lead can carry a dozen+ service
 *  tags (skills scraped off a freelancer profile, not just G3's own service
 *  list) -- rendering them inline as wrapped pills blew the row height out
 *  to a full screen's worth of tags for a single lead. Shared by both leads
 *  tables (owner/recruiter) and, unlike the two tables' `<td>` markup, has
 *  no reason to diverge between them. */
export function ServicesCell({
  services, onRemove,
}: {
  services: string[];
  onRemove: (service: string) => void;
}) {
  if (services.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-accent/20 bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/20"
        >
          {services.length} service{services.length > 1 ? "s" : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
          {services.map((s) => (
            <div key={s} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50">
              <span className="truncate">{s}</span>
              <button
                type="button"
                aria-label={`Remove service ${s}`}
                onClick={() => onRemove(s)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
