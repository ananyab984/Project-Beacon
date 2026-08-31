import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { api } from "@/lib/api";

/**
 * The Owner console's top-right search bar used to be a plain, inert <div>
 * -- no onClick, no keyboard listener, no backend behind it, styled to look
 * like a search box. This wires it to the existing (previously unused)
 * cmdk-based Command primitive, using the same list endpoints
 * search-lead-dialog.tsx already fetches leads through, plus recruiters/
 * contractors/clients. No new backend endpoint needed -- everything here
 * was already exposed via api.ts.
 */
export function GlobalSearchDialog() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Only fetched once the dialog is actually opened -- same lazy pattern
  // search-lead-dialog.tsx already uses for its leads query.
  const leadsQuery = useQuery({
    queryKey: ["leads", "global-search"],
    queryFn: () => api.getLeads({ limit: 100 }),
    enabled: open,
  });
  const recruitersQuery = useQuery({
    queryKey: ["users", "RECRUITER", "global-search"],
    queryFn: () => api.getUsers("RECRUITER"),
    enabled: open,
  });
  const contractorsQuery = useQuery({
    queryKey: ["users", "CONTRACTOR", "global-search"],
    queryFn: () => api.getUsers("CONTRACTOR"),
    enabled: open,
  });
  const clientsQuery = useQuery({
    queryKey: ["clients", "global-search"],
    queryFn: () => api.getClients(),
    enabled: open,
  });

  const leads = leadsQuery.data?.leads ?? [];
  const people = [...(recruitersQuery.data?.users ?? []), ...(contractorsQuery.data?.users ?? [])];
  const clients = clientsQuery.data?.clients ?? [];

  function goToLead(name: string) {
    setOpen(false);
    navigate({ to: "/owner/leads", search: { q: name || undefined } });
  }
  function goToRecruiter() {
    setOpen(false);
    navigate({ to: "/owner/recruiters" });
  }
  function goToClient(name: string) {
    setOpen(false);
    navigate({ to: "/owner/clients", search: { q: name || undefined } });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground md:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="text-xs">Search leads, recruiters, clients…</span>
        <kbd className="ml-6 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Search leads, recruiters, clients…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          <CommandGroup heading="Leads">
            {leads.map((l) => {
              const name = l.fullName || l.displayName || "Unnamed lead";
              return (
                <CommandItem key={l.id} value={`${name} ${l.email || ""}`} onSelect={() => goToLead(name)}>
                  <span className="truncate">{name}</span>
                  {l.email && <span className="ml-2 truncate text-xs text-muted-foreground">{l.email}</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>

          <CommandGroup heading="Recruiters & Contractors">
            {people.map((p) => (
              <CommandItem key={p.id} value={`${p.name} ${p.email}`} onSelect={goToRecruiter}>
                <span className="truncate">{p.name}</span>
                <span className="ml-2 truncate text-xs text-muted-foreground">{p.email}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Clients">
            {clients.map((c) => (
              <CommandItem key={c.id} value={c.name} onSelect={() => goToClient(c.name)}>
                <span className="truncate">{c.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
