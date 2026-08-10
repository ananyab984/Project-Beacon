import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

export function ReadRateTooltip({ children }: { children?: ReactNode }) {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-muted-foreground/70 cursor-help">
            {children ?? <Info className="h-3 w-3" />}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          Directional only. Apple Mail Privacy Protection auto-downloads images and inflates opens across devices.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}