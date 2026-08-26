import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Trash2, Plus } from "lucide-react";

export function FaqManager() {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Fetch all FAQs
  const { data, isLoading } = useQuery({
    queryKey: ["faqs"],
    queryFn: async () => {
      const result = await api.listFaqs();
      return result.faqEntries;
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (formData: any) => api.createFaq(formData),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["faqs"] });
      toast.success(`FAQ created${response.keywordsGenerated ? " with auto-generated keywords" : ""}`);
      setIsCreating(false);
    },
    onError: (err: any) => {
      toast.error(`Failed to create FAQ: ${err.message}`);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.updateFaq(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["faqs"] });
      toast.success("FAQ updated");
      setEditingId(null);
    },
    onError: (err: any) => {
      toast.error(`Failed to update FAQ: ${err.message}`);
    },
  });

  // Delete mutation
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

  if (isLoading) return <div className="p-4">Loading FAQs...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Manage FAQs</h2>
        <Button onClick={() => setIsCreating(true)} className="gap-2">
          <Plus size={16} />
          Add FAQ
        </Button>
      </div>

      {isCreating && <CreateFaqForm onSubmit={createMutation.mutate} isLoading={createMutation.isPending} onCancel={() => setIsCreating(false)} />}

      {/* FAQ List */}
      <div className="space-y-3">
        {data?.map((faq) => (
          <div key={faq.id} className="border rounded-lg p-4">
            {editingId === faq.id ? (
              <EditFaqForm faq={faq} onSubmit={(data: any) => updateMutation.mutate({ id: faq.id, data })} isLoading={updateMutation.isPending} onCancel={() => setEditingId(null)} />
            ) : (
              <>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 mb-1">{faq.category}</p>
                    <p className="font-semibold text-lg mb-2">{faq.question}</p>
                    <p className="text-gray-700 mb-2">{faq.answer}</p>
                    {faq.tags.length > 0 && (
                      <div className="flex gap-2 flex-wrap">
                        {faq.tags.map((tag) => (
                          <span key={tag} className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button variant="outline" size="sm" onClick={() => setEditingId(faq.id)} className="gap-1">
                      <Pencil size={14} />
                      Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => deleteMutation.mutate(faq.id)} className="gap-1 text-red-600">
                      <Trash2 size={14} />
                      Delete
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateFaqForm({ onSubmit, isLoading, onCancel }: any) {
  const [formData, setFormData] = useState({ category: "", question: "", answer: "" });

  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      <h3 className="font-semibold mb-4">Create New FAQ</h3>
      <div className="space-y-3">
        <Input placeholder="Category (e.g., Training, Payment)" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} />
        <Input placeholder="Question" value={formData.question} onChange={(e) => setFormData({ ...formData, question: e.target.value })} />
        <Textarea placeholder="Answer" value={formData.answer} onChange={(e) => setFormData({ ...formData, answer: e.target.value })} className="min-h-24" />
        <div className="flex gap-2">
          <Button onClick={() => onSubmit(formData)} disabled={isLoading || !formData.category || !formData.question || !formData.answer}>
            {isLoading ? "Creating..." : "Create FAQ"}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditFaqForm({ faq, onSubmit, isLoading, onCancel }: any) {
  const [formData, setFormData] = useState({ category: faq.category, question: faq.question, answer: faq.answer, tags: faq.tags });

  return (
    <div className="border rounded-lg p-4 bg-gray-50">
      <h3 className="font-semibold mb-4">Edit FAQ</h3>
      <div className="space-y-3">
        <Input placeholder="Category" value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} />
        <Input placeholder="Question" value={formData.question} onChange={(e) => setFormData({ ...formData, question: e.target.value })} />
        <Textarea placeholder="Answer" value={formData.answer} onChange={(e) => setFormData({ ...formData, answer: e.target.value })} className="min-h-24" />
        <div>
          <label className="text-sm font-medium">Keywords (comma-separated, edit to refine)</label>
          <Input placeholder="e.g., training, payment, schedule" value={formData.tags.join(", ")} onChange={(e) => setFormData({ ...formData, tags: e.target.value.split(",").map((t) => t.trim()) })} />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => onSubmit(formData)} disabled={isLoading}>
            {isLoading ? "Saving..." : "Save FAQ"}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
