import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pencil, Trash2, Plus } from "lucide-react";

export const Route = createFileRoute("/owner/faqs")({
  component: FaqsPage,
});

function FaqsPage() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["faqs"],
    queryFn: async () => {
      const result = await api.listFaqs();
      return result.faqEntries;
    },
  });

  const createMutation = useMutation({
    mutationFn: (formData: any) => api.createFaq(formData),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["faqs"] });
      toast.success(`FAQ created${response.keywordsGenerated ? " with auto-generated keywords" : ""}`);
      setIsCreateOpen(false);
    },
    onError: (err: any) => {
      toast.error(`Failed to create FAQ: ${err.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.updateFaq(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["faqs"] });
      toast.success("FAQ updated");
      setEditingFaq(null);
    },
    onError: (err: any) => {
      toast.error(`Failed to update FAQ: ${err.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteFaq(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["faqs"] });
      toast.success("FAQ deleted");
    },
    onError: (err: any) => {
      toast.error(`Failed to delete FAQ: ${err.message}`);
    },
  });

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Loading FAQs...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">FAQs</h1>
          <p className="text-muted-foreground mt-1">Manage frequently asked questions. Keywords are auto-generated on creation.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
          <Plus size={16} />
          Create FAQ
        </Button>
      </div>

      {/* FAQ List */}
      {data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map((faq) => {
            const snippet = faq.answer.length > 150 ? `${faq.answer.substring(0, 150)}...` : faq.answer;
            return (
              <div key={faq.id} className="border rounded-lg p-4 hover:bg-muted/50 transition">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground mb-1 uppercase">{faq.category}</p>
                    <h3 className="font-semibold text-base mb-2 line-clamp-2">{faq.question}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">{snippet}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingFaq(faq)}
                      className="gap-1"
                    >
                      <Pencil size={16} />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (
                          confirm(`Delete the FAQ "${faq.question}"? This cannot be undone.`)
                        ) {
                          deleteMutation.mutate(faq.id);
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
            );
          })}
        </div>
      ) : (
        <div className="border rounded-lg p-12 text-center">
          <p className="text-muted-foreground mb-4">No FAQs yet. Create one to get started.</p>
          <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
            <Plus size={16} />
            Create your first FAQ
          </Button>
        </div>
      )}

      {/* Create Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New FAQ</DialogTitle>
          </DialogHeader>
          <CreateFaqForm
            onSubmit={createMutation.mutate}
            isLoading={createMutation.isPending}
            onCancel={() => setIsCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      {editingFaq && (
        <Dialog open={!!editingFaq} onOpenChange={(open) => !open && setEditingFaq(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit FAQ</DialogTitle>
            </DialogHeader>
            <EditFaqForm
              faq={editingFaq}
              onSubmit={(data: any) => updateMutation.mutate({ id: editingFaq.id, data })}
              isLoading={updateMutation.isPending}
              onCancel={() => setEditingFaq(null)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function CreateFaqForm({ onSubmit, isLoading, onCancel }: any) {
  const [formData, setFormData] = useState({ category: "", question: "", answer: "" });
  const isValid = formData.category?.trim() && formData.question?.trim() && formData.answer?.trim();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="create-category" className="text-sm font-medium">
          Category
        </label>
        <Input
          id="create-category"
          placeholder="e.g., Training, Payment, Schedule"
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="create-question" className="text-sm font-medium">
          Question
        </label>
        <Input
          id="create-question"
          placeholder="What is the main question?"
          value={formData.question}
          onChange={(e) => setFormData({ ...formData, question: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="create-answer" className="text-sm font-medium">
          Answer
        </label>
        <Textarea
          id="create-answer"
          placeholder="Provide a detailed answer..."
          value={formData.answer}
          onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
          className="min-h-32"
        />
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSubmit(formData)} disabled={isLoading || !isValid}>
          {isLoading ? "Creating..." : "Create FAQ"}
        </Button>
      </div>
    </div>
  );
}

function EditFaqForm({ faq, onSubmit, isLoading, onCancel }: any) {
  const [formData, setFormData] = useState({
    category: faq.category,
    question: faq.question,
    answer: faq.answer,
  });
  const [tagsText, setTagsText] = useState<string>((faq.tags ?? []).filter(Boolean).join(", "));
  const isValid = formData.category?.trim() && formData.question?.trim() && formData.answer?.trim();

  const handleSubmit = () => {
    const tags = tagsText
      .split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);
    onSubmit({ ...formData, tags });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="edit-category" className="text-sm font-medium">
          Category
        </label>
        <Input
          id="edit-category"
          value={formData.category}
          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="edit-question" className="text-sm font-medium">
          Question
        </label>
        <Input
          id="edit-question"
          value={formData.question}
          onChange={(e) => setFormData({ ...formData, question: e.target.value })}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="edit-answer" className="text-sm font-medium">
          Answer
        </label>
        <Textarea
          id="edit-answer"
          value={formData.answer}
          onChange={(e) => setFormData({ ...formData, answer: e.target.value })}
          className="min-h-32"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="edit-keywords" className="text-sm font-medium">
          Keywords (comma-separated)
        </label>
        <Input
          id="edit-keywords"
          placeholder="e.g., training, payment, schedule"
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Edit to refine auto-generated keywords from creation.</p>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={isLoading || !isValid}>
          {isLoading ? "Saving..." : "Save FAQ"}
        </Button>
      </div>
    </div>
  );
}
