import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/owner/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Global3" },
      { name: "description", content: "Owner settings: AI tools, roles, integrations, exports, audit trail." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [showAI, setShowAI] = useState(false);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Section
        title="AI tools"
        desc="AI metrics and pipeline tools are hidden by default so day-to-day oversight stays focused on recruiter, lead and language signals."
      >
        <Row
          title="Show AI tools"
          desc="Reveals LinkedIn match confidence, reply-to-classification accuracy, and the AI Pipeline management section below."
        >
          <Switch checked={showAI} onCheckedChange={setShowAI} />
        </Row>
      </Section>

      {showAI && (
        <Section
          title="AI Pipeline management"
          desc="Under review — surface with beta styling; not for day-to-day decisions."
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <BetaCard
              title="LinkedIn match confidence"
              body="Identity-resolution confidence score for ambiguous records. Example: masked lead #H-7724 at 0.55 confidence."
            />
            <BetaCard
              title="Reply-to-classification accuracy"
              body="Agreement between AI's read on a reply and recruiter conclusion. Sampled on Madhu's queue — 62%."
            />
            <DeferredCard title="AI-draft edit rate" />
            <DeferredCard title="Time-to-first-reply by language / channel" />
            <DeferredCard title="Data health trend — shrinking unresolved-identity records" />
          </div>
        </Section>
      )}

      <Section title="Roles & permissions">
        <div className="divide-y divide-border">
          {[
            { name: "Ethan", role: "Owner", access: "Monitoring only" },
            { name: "Divya", role: "Full-access recruiter", access: "All leads · outreach · approvals" },
            { name: "Madhu", role: "Full-access recruiter", access: "All leads · outreach · approvals" },
            { name: "Sharmista", role: "Full-access recruiter", access: "All leads · outreach · approvals" },
            { name: "Contractor A", role: "Contractor recruiter", access: "Search-only + submit" },
            { name: "Contractor B", role: "Contractor recruiter", access: "Search-only + submit" },
          ].map((u) => (
            <div key={u.name} className="grid grid-cols-3 items-center gap-4 py-3 text-sm">
              <div className="font-medium">{u.name}</div>
              <div className="text-muted-foreground">{u.role}</div>
              <div className="text-right text-xs text-foreground/80">{u.access}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Audit trail" desc="Latest system events. Retained indefinitely per data retention policy.">
        <div className="rounded-lg border border-border">
          {[
            { t: "09:42", w: "Divya", a: "sent outreach to Lead #G-6613" },
            { t: "09:31", w: "System", a: "flagged Lead #F-5502 for possible DNC conflict" },
            { t: "08:12", w: "Madhu", a: "reclassified reply on Lead #B-2201 (Interested, not FAQ)" },
            { t: "Yesterday", w: "Sharmista", a: "onboarded Verified Lead 4401" },
            { t: "Yesterday", w: "System", a: "re-enriched 12 unresolved-identity records" },
          ].map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[90px_120px_1fr] items-center gap-3 border-b border-border px-4 py-2 text-xs last:border-0"
            >
              <span className="text-muted-foreground tabular-nums">{r.t}</span>
              <span className="font-medium">{r.w}</span>
              <span className="text-foreground/80">{r.a}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <h3 className="text-base font-semibold">{title}</h3>
      {desc && <p className="mt-1 text-xs text-muted-foreground">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-muted-foreground max-w-lg">{desc}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function BetaCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant="outline" className="border-warning/50 text-warning text-[10px]">
          Under review
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

function DeferredCard({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 opacity-70">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">{title}</div>
        <Badge variant="outline" className="text-[10px]">
          Coming soon
        </Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Widget disabled until validation.</p>
    </div>
  );
}
