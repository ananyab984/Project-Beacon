import { G3Logo } from "@/components/features/logo";
import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-2">
        <div className="hidden flex-col justify-between border-r border-border/60 bg-card/40 p-10 lg:flex">
          <G3Logo />
          <div className="space-y-5">
            <h2 className="text-3xl font-semibold leading-tight tracking-tight text-foreground">
              Recruitment automation, run like a modern enterprise.
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              Global3 gives operators end-to-end visibility across clients, recruiters and candidates — without the operational drag of legacy ATS stacks.
            </p>
            <div className="flex items-center gap-6 pt-4 text-xs text-muted-foreground">
              <div><span className="text-foreground font-semibold">27</span> languages</div>
              <div><span className="text-foreground font-semibold">4.2×</span> outreach lift</div>
              <div><span className="text-foreground font-semibold">98%</span> profile completeness</div>
            </div>
          </div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground/60">© Global3 · Owner Console</div>
        </div>
        <div className="flex flex-col justify-center p-8 sm:p-12">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8 lg:hidden"><G3Logo /></div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-6 text-sm text-muted-foreground">{footer}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}