import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ReplyCategory } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/owner/reply-categories")({
  component: ReplyCategoriesPage,
});

function ReplyCategoriesPage() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ReplyCategory | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["reply-categories"],
    queryFn: () => api.listReplyCategories(),
  });
  const categories = data?.replyCategories ?? [];
  // Single server-side kill switch (server/src/config.ts's
  // replyClassificationEnabled) -- defaults to true while loading so this
  // page doesn't flash a "disabled" banner on the common (enabled) path.
  const featureEnabled = data?.featureEnabled ?? true;

  const createMutation = useMutation({
    mutationFn: (formData: any) => api.createReplyCategory(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reply-categories"] });
      toast.success("Reply category created");
      setIsCreateOpen(false);
    },
    onError: (err: any) => {
      toast.error(`Failed to create reply category: ${err.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.updateReplyCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reply-categories"] });
      toast.success("Reply category updated");
      setEditingCategory(null);
    },
    onError: (err: any) => {
      toast.error(`Failed to update reply category: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteReplyCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reply-categories"] });
      toast.success("Reply category deleted");
    },
    onError: (err: any) => {
      toast.error(`Failed to delete reply category: ${err.message}`);
    },
  });

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading reply categories...</div>;
  }

  if (!featureEnabled) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Reply Categories</h1>
        </div>
        <div className="border rounded-lg p-12 text-center">
          <p className="text-muted-foreground">
            Reply classification is currently disabled. Set <code className="text-xs">REPLY_CLASSIFICATION_ENABLED=true</code> on the server to re-enable it and manage categories again.
          </p>
        </div>
      </div>
    );
  }

  const grouped = new Map<string, ReplyCategory[]>();
  for (const c of categories) {
    const list = grouped.get(c.groupName) ?? [];
    list.push(c);
    grouped.set(c.groupName, list);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Reply Categories</h1>
          <p className="text-muted-foreground mt-1">Manage the categories inbound lead replies are classified into.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
          <Plus size={16} />
          Create Category
        </Button>
      </div>

      {grouped.size > 0 ? (
        <div className="space-y-8">
          {Array.from(grouped.entries()).map(([groupName, categories]) => (
            <div key={groupName} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{groupName}</h2>
              {categories.map((category) => (
                <div key={category.id} className="border rounded-lg p-4 hover:bg-muted/50 transition">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base mb-1">{category.name}</h3>
                      <p className="text-sm text-muted-foreground">{category.description}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => setEditingCategory(category)} className="gap-1">
                        <Pencil size={16} />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Delete the category "${category.name}"? Leads currently classified with it will show as Unclassified.`)) {
                            deleteMutation.mutate(category.id);
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="gap-1 text-destructive hover:text-destructive"
                      >
                        <Trash2 size={16} />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="border rounded-lg p-12 text-center">
          <p className="text-muted-foreground mb-4">No reply categories yet. Create one to get started.</p>
          <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Plus size={16} />
            Create your first category
          </Button>
        </div>
      )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Reply Category</DialogTitle>
          </DialogHeader>
          <CategoryForm onSubmit={createMutation.mutate} isLoading={createMutation.isPending} onCancel={() => setIsCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      {editingCategory && (
        <Dialog open={!!editingCategory} onOpenChange={(open) => !open && setEditingCategory(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Reply Category</DialogTitle>
            </DialogHeader>
            <CategoryForm
              initial={editingCategory}
              onSubmit={(data: any) => updateMutation.mutate({ id: editingCategory.id, data })}
              isLoading={updateMutation.isPending}
              onCancel={() => setEditingCategory(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CategoryForm({ initial, onSubmit, isLoading, onCancel }: { initial?: ReplyCategory; onSubmit: (data: any) => void; isLoading: boolean; onCancel: () => void }) {
  const [formData, setFormData] = useState({
    groupName: initial?.groupName ?? "",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
  });
  const isValid = formData.groupName.trim() && formData.name.trim() && formData.description.trim();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="rc-group" className="text-sm font-medium">Group</label>
        <Input
          id="rc-group"
          placeholder="e.g., Payment & Invoicing"
          value={formData.groupName}
          onChange={(e) => setFormData({ ...formData, groupName: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="rc-name" className="text-sm font-medium">Name</label>
        <Input
          id="rc-name"
          placeholder="e.g., Rate Query"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="rc-description" className="text-sm font-medium">Description / Trigger</label>
        <Textarea
          id="rc-description"
          placeholder="What kind of reply should match this category?"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="min-h-24"
        />
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(formData)} disabled={isLoading || !isValid}>
          {isLoading ? "Saving..." : initial ? "Save Category" : "Create Category"}
        </Button>
      </div>
    </div>
  );
}
