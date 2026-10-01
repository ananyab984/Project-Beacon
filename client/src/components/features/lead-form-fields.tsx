import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COUNTRIES } from "@/lib/countries";
import { STANDARD_SERVICES } from "@/lib/services";

/** Shared by Add a Lead and Contractor Add a Lead -- both previously had a
 * free-text "Country of Residence" Input defaulting to "Germany", so an
 * untouched field silently submitted "Germany" for every new lead regardless
 * of where the candidate actually lives. */
export function CountrySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-xs bg-card">
        <SelectValue placeholder="Select country" />
      </SelectTrigger>
      <SelectContent>
        {COUNTRIES.map((c) => (
          <SelectItem key={c} value={c}>{c}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const SERVICE_OTHERS_VALUE = "Others";

/** Shared Services picker: a real service, or "Others" -> a Custom Service +
 * Custom Task pair (mirrors Global3's own candidate-onboarding form, which
 * splits an out-of-list service into those same two fields rather than one
 * free-text box). */
export function ServicePicker({
  value,
  onChange,
  customService,
  onCustomServiceChange,
  customTask,
  onCustomTaskChange,
}: {
  value: string;
  onChange: (v: string) => void;
  customService: string;
  onCustomServiceChange: (v: string) => void;
  customTask: string;
  onCustomTaskChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-xs bg-card">
          <SelectValue placeholder="Select Service" />
        </SelectTrigger>
        <SelectContent>
          {STANDARD_SERVICES.map((s) => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
          <SelectItem value={SERVICE_OTHERS_VALUE}>
            <span className="flex items-center gap-1.5 text-primary font-semibold">
              <Plus className="h-3.5 w-3.5" /> Others
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {value === SERVICE_OTHERS_VALUE && (
        <div className="grid grid-cols-2 gap-1.5">
          <Input
            value={customService}
            onChange={(e) => onCustomServiceChange(e.target.value)}
            placeholder="Custom Service"
            className="h-8 text-xs bg-card border-primary/50"
            autoFocus
          />
          <Input
            value={customTask}
            onChange={(e) => onCustomTaskChange(e.target.value)}
            placeholder="Custom Task"
            className="h-8 text-xs bg-card border-primary/50"
          />
        </div>
      )}
    </div>
  );
}

/** Resolves the Services picker's state into the comma-joined string the
 * dialogs already split on "," to build the final services[] array -- when
 * both custom fields are filled, Custom Service and Custom Task become two
 * separate entries, same as picking two real services would. */
export function resolveServiceValue(service: string, customService: string, customTask: string): string {
  if (service !== SERVICE_OTHERS_VALUE) return service;
  return [customService.trim(), customTask.trim()].filter(Boolean).join(", ");
}
