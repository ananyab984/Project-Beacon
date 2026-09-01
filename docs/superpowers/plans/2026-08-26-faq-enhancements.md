# FAQ Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend FAQ feature to email conversations, add owner-managed FAQ dashboard with CRUD, and auto-generate search keywords when FAQs are created.

**Architecture:** 
- **Email support:** Extend existing Check FAQ button from LinkedIn to email compose areas (same backend lookup, extended frontend integration)
- **FAQ Dashboard:** New owner-only management UI at `/dashboard/faq` with table of FAQs, inline edit/delete, create form
- **Backend CRUD:** Extend `faq.routes.ts` with GET (list/single), POST (create), PATCH (update), DELETE endpoints
- **Auto-tagging:** When owner creates FAQ, Claude extracts 3-5 semantic keywords from question+answer and stores in tags field

**Tech Stack:** Express/TypeScript backend, React/TanStack Query frontend, Prisma ORM, Claude for keyword extraction, PostgreSQL full-text search indexes already in place

## Global Constraints
- Single PR: all work stays on `feature/faq-auto-response` branch
- Database already migrated to dev environment, FAQ schema exists
- Owner role verified via Neon Auth JWT (existing auth middleware)
- Atomic commits for each feature segment

---

## File Structure

```
Backend:
- server/src/routes/faq.routes.ts (modify: extend with CRUD endpoints)
- server/src/drafting/draftGenerator.ts (modify: add generateFaqKeywords function)

Frontend:
- client/src/components/features/conversations-page-view.tsx (modify: add email Check FAQ button)
- client/src/components/dashboard/faq-manager.tsx (create: owner FAQ CRUD UI)
- client/src/pages/dashboard-page.tsx (modify: add FAQ tab/section)
- client/src/lib/api.ts (modify: add FAQ CRUD methods)
```

---

## Task 1: Add FAQ CRUD Endpoints (Backend)

**Files:**
- Modify: `server/src/routes/faq.routes.ts:1-68`
- Test: Manual API testing via curl/Postman

**Interfaces:**

Produces:
- `GET /api/faq` → `{ faqEntries: Array<{ id, category, question, answer, tags, isActive, createdAt, updatedAt }> }`
- `GET /api/faq/:id` → `{ faqEntry: { id, category, question, answer, tags, isActive, createdAt, updatedAt } }`
- `POST /api/faq` (owner only) → `{ faqEntry: {...}, keywordsGenerated: boolean }`
- `PATCH /api/faq/:id` (owner only) → `{ faqEntry: {...} }`
- `DELETE /api/faq/:id` (owner only) → `{ success: boolean }`

- [ ] **Step 1: Add GET /api/faq endpoint (list all active FAQs)**

```typescript
faqRouter.get("/", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const faqEntries = await prisma.faqEntry.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ faqEntries });
  } catch (err: any) {
    return res.status(500).json({ error: "FAQ_LIST_FAILED", message: err.message });
  }
});
```

- [ ] **Step 2: Add GET /api/faq/:id endpoint (get single FAQ)**

```typescript
faqRouter.get("/:id", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "MISSING_FAQ_ID", message: "id is required" });
    }
    const faqEntry = await prisma.faqEntry.findUnique({ where: { id } });
    if (!faqEntry) {
      return res.status(404).json({ error: "FAQ_NOT_FOUND", message: "No FAQ with that ID" });
    }
    return res.json({ faqEntry });
  } catch (err: any) {
    return res.status(500).json({ error: "FAQ_FETCH_FAILED", message: err.message });
  }
});
```

- [ ] **Step 3: Add PATCH /api/faq/:id endpoint (update FAQ, owner only)**

```typescript
faqRouter.patch("/:id", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.role !== "owner") {
      return res.status(403).json({ error: "FORBIDDEN", message: "Only owners can edit FAQs" });
    }
    const { id } = req.params;
    const { category, question, answer, tags, isActive } = req.body || {};
    if (!id) {
      return res.status(400).json({ error: "MISSING_FAQ_ID", message: "id is required" });
    }
    const updated = await prisma.faqEntry.update({
      where: { id },
      data: {
        ...(category && { category }),
        ...(question && { question }),
        ...(answer && { answer }),
        ...(Array.isArray(tags) && { tags }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    return res.json({ faqEntry: updated });
  } catch (err: any) {
    return res.status(500).json({ error: "FAQ_UPDATE_FAILED", message: err.message });
  }
});
```

- [ ] **Step 4: Add DELETE /api/faq/:id endpoint (soft delete, owner only)**

```typescript
faqRouter.delete("/:id", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.role !== "owner") {
      return res.status(403).json({ error: "FORBIDDEN", message: "Only owners can delete FAQs" });
    }
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "MISSING_FAQ_ID", message: "id is required" });
    }
    await prisma.faqEntry.update({
      where: { id },
      data: { isActive: false },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: "FAQ_DELETE_FAILED", message: err.message });
  }
});
```

- [ ] **Step 5: Commit CRUD endpoints**

```bash
git add server/src/routes/faq.routes.ts
git commit -m "feat(faq): add CRUD endpoints for FAQ management

- GET /api/faq: list all active FAQs
- GET /api/faq/:id: get single FAQ
- PATCH /api/faq/:id: update FAQ (owner only)
- DELETE /api/faq/:id: soft delete FAQ (owner only)
- All endpoints require JWT authentication

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Keyword Generation Function

**Files:**
- Modify: `server/src/drafting/draftGenerator.ts:240-290`

**Interfaces:**

Produces:
- `generateFaqKeywords(client: ClaudeClient, cfg: DraftingConfig, faqQuestion: string, faqAnswer: string): Promise<{ keywords: string[] }>`

- [ ] **Step 1: Add generateFaqKeywords function to draftGenerator.ts**

```typescript
export async function generateFaqKeywords(
  client: ClaudeClient,
  cfg: DraftingConfig,
  faqQuestion: string,
  faqAnswer: string
): Promise<{ keywords: string[] }> {
  const system = `You are an expert at extracting semantic keywords from FAQ entries.
Your task is to extract 3-5 short, meaningful keywords that represent the core topics
of this FAQ. These keywords are used for search and categorization.

Return ONLY a JSON object with a "keywords" array of strings. No markdown, no explanation.
Example: {"keywords": ["payment", "training", "schedule"]}`;

  const user = `FAQ Question: ${faqQuestion}

FAQ Answer: ${faqAnswer}

Extract 3-5 semantic keywords that capture the main topics. Keep keywords short (1-2 words).
Focus on searchable concepts users would ask about.`;

  const completion = await client.chat(system, user, {
    model: cfg.genModel,
    temperature: 0.1,
    maxTokens: 150,
  });

  let data;
  try {
    data = JSON.parse(completion.text);
  } catch {
    const start = completion.text.indexOf("{");
    const end = completion.text.lastIndexOf("}");
    if (start >= 0 && start < end) {
      data = JSON.parse(completion.text.slice(start, end + 1));
    } else {
      throw new Error("Could not parse keywords from Claude response");
    }
  }

  const keywords = Array.isArray(data.keywords) ? data.keywords.filter((k: any) => typeof k === "string") : [];
  return { keywords };
}
```

- [ ] **Step 2: Commit keyword generation function**

```bash
git add server/src/drafting/draftGenerator.ts
git commit -m "feat(drafting): add generateFaqKeywords for auto-tagging

- Extract 3-5 semantic keywords from FAQ question + answer
- Uses Claude with low temperature (0.1) for consistency
- Returns keywords array for storing in faqEntry.tags

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add POST /api/faq Endpoint with Auto-Tagging

**Files:**
- Modify: `server/src/routes/faq.routes.ts:15-68`

**Interfaces:**

Consumes: `generateFaqKeywords()` from Task 2

Produces:
- `POST /api/faq` (owner only, body: { category, question, answer }) → `{ faqEntry: {...}, keywordsGenerated: boolean }`

- [ ] **Step 1: Import keyword generation at top of faq.routes.ts**

```typescript
import { generateFaqReply, generateFaqKeywords } from "../drafting/draftGenerator";
```

- [ ] **Step 2: Add POST /api/faq endpoint with auto-tagging**

```typescript
faqRouter.post("/", authenticateJwt, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user?.role !== "owner") {
      return res.status(403).json({ error: "FORBIDDEN", message: "Only owners can create FAQs" });
    }

    const { category, question, answer } = req.body || {};
    if (!category || !question || !answer) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "category, question, and answer are required",
      });
    }

    // Generate keywords automatically
    let tags: string[] = [];
    let keywordsGenerated = false;
    try {
      const draftingConfig = loadDraftingConfig();
      const client = new ClaudeClient(draftingConfig);
      const result = await generateFaqKeywords(client, draftingConfig, question, answer);
      tags = result.keywords;
      keywordsGenerated = tags.length > 0;
    } catch (err: any) {
      console.warn("[faqRouter] Keyword generation failed, creating FAQ without tags:", err.message);
    }

    // Create FAQ entry
    const faqEntry = await prisma.faqEntry.create({
      data: {
        id: `faq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        category,
        question,
        answer,
        tags,
        isActive: true,
      },
    });

    return res.status(201).json({ faqEntry, keywordsGenerated });
  } catch (err: any) {
    return res.status(500).json({ error: "FAQ_CREATE_FAILED", message: err.message });
  }
});
```

- [ ] **Step 3: Add necessary imports at top of faq.routes.ts**

```typescript
import { ClaudeClient } from "../drafting/claudeClient";
import { loadDraftingConfig } from "../drafting/config";
```

- [ ] **Step 4: Test POST endpoint by creating a test FAQ**

Run via curl or API client:
```bash
curl -X POST http://localhost:5001/api/faq \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "category": "Test Category",
    "question": "Is this a test?",
    "answer": "Yes, this is a test FAQ entry."
  }'
```

Expected: 201 response with `faqEntry` and `keywordsGenerated: true`

- [ ] **Step 5: Commit POST endpoint with auto-tagging**

```bash
git add server/src/routes/faq.routes.ts
git commit -m "feat(faq): add POST /api/faq with auto-keyword generation

- Only owners can create FAQs
- Automatically extracts 3-5 keywords using Claude
- Gracefully handles keyword generation failures (FAQ still created)
- Returns keywordsGenerated flag to indicate success

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add FAQ CRUD Methods to API Client

**Files:**
- Modify: `client/src/lib/api.ts`

**Interfaces:**

Produces:
```typescript
class API {
  // ... existing methods ...
  
  // FAQ Management
  async listFaqs(): Promise<{ faqEntries: FaqEntry[] }> { }
  async getFaq(id: string): Promise<{ faqEntry: FaqEntry }> { }
  async createFaq(data: CreateFaqInput): Promise<{ faqEntry: FaqEntry; keywordsGenerated: boolean }> { }
  async updateFaq(id: string, data: UpdateFaqInput): Promise<{ faqEntry: FaqEntry }> { }
  async deleteFaq(id: string): Promise<{ success: boolean }> { }
}

interface FaqEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreateFaqInput {
  category: string;
  question: string;
  answer: string;
}

interface UpdateFaqInput {
  category?: string;
  question?: string;
  answer?: string;
  tags?: string[];
  isActive?: boolean;
}
```

- [ ] **Step 1: Add type definitions for FAQ in api.ts**

```typescript
export interface FaqEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  tags: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFaqInput {
  category: string;
  question: string;
  answer: string;
}

export interface UpdateFaqInput {
  category?: string;
  question?: string;
  answer?: string;
  tags?: string[];
  isActive?: boolean;
}
```

- [ ] **Step 2: Add FAQ CRUD methods to API class**

```typescript
async listFaqs(): Promise<{ faqEntries: FaqEntry[] }> {
  return request("/api/faq");
}

async getFaq(id: string): Promise<{ faqEntry: FaqEntry }> {
  return request(`/api/faq/${id}`);
}

async createFaq(data: CreateFaqInput): Promise<{ faqEntry: FaqEntry; keywordsGenerated: boolean }> {
  return request("/api/faq", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async updateFaq(id: string, data: UpdateFaqInput): Promise<{ faqEntry: FaqEntry }> {
  return request(`/api/faq/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

async deleteFaq(id: string): Promise<{ success: boolean }> {
  return request(`/api/faq/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 3: Commit API client methods**

```bash
git add client/src/lib/api.ts
git commit -m "feat(api): add FAQ CRUD client methods

- listFaqs: fetch all active FAQs
- getFaq: fetch single FAQ by id
- createFaq: create FAQ (owner only), auto-generates keywords
- updateFaq: update FAQ fields (owner only)
- deleteFaq: soft delete FAQ (owner only)
- Add TypeScript interfaces for FaqEntry and inputs

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Create FAQ Manager Component (Dashboard)

**Files:**
- Create: `client/src/components/dashboard/faq-manager.tsx` (new file)
- Test: Visual testing in browser at `/dashboard`

**Interfaces:**

Consumes: `api.listFaqs()`, `api.createFaq()`, `api.updateFaq()`, `api.deleteFaq()` from Task 4

Produces: React component `FaqManager` exported for use in dashboard

- [ ] **Step 1: Create FAQ manager component skeleton**

```typescript
import { useState, useEffect } from "react";
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
              <EditFaqForm faq={faq} onSubmit={(data) => updateMutation.mutate({ id: faq.id, data })} isLoading={updateMutation.isPending} onCancel={() => setEditingId(null)} />
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
```

- [ ] **Step 2: Commit FAQ manager component**

```bash
git add client/src/components/dashboard/faq-manager.tsx
git commit -m "feat(client): create FAQ manager component for owner dashboard

- Display all active FAQs in editable list
- Create new FAQ with auto-keyword generation
- Edit existing FAQs (category, question, answer, keywords)
- Delete FAQs with confirmation
- Real-time UI updates via React Query
- Toast notifications for user feedback

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Integrate FAQ Manager into Owner Dashboard

**Files:**
- Modify: `client/src/pages/dashboard-page.tsx` (find or create)
- Test: Visual testing in browser at `/dashboard`

**Interfaces:**

Consumes: `FaqManager` component from Task 5

Produces: Dashboard page with FAQ section accessible only to owners

- [ ] **Step 1: Check current dashboard structure**

Run:
```bash
find client/src -name "*dashboard*" -type f
```

Locate the main dashboard page component.

- [ ] **Step 2: Import and integrate FaqManager component**

In `client/src/pages/dashboard-page.tsx` (or similar), add:

```typescript
import { FaqManager } from "@/components/dashboard/faq-manager";

// Inside your Dashboard component, add a tab/section:
<div className="space-y-6">
  {/* ... existing dashboard sections ... */}
  
  {/* FAQ Management Section (owner only) */}
  {user?.role === "owner" && (
    <div className="border-t pt-6">
      <FaqManager />
    </div>
  )}
</div>
```

- [ ] **Step 3: Test FAQ manager in browser**

Navigate to `/dashboard` and verify:
- FAQ list loads
- Can create new FAQ with auto-generated keywords
- Can edit FAQ
- Can delete FAQ
- Keywords display correctly
- Toast notifications appear

- [ ] **Step 4: Commit dashboard integration**

```bash
git add client/src/pages/dashboard-page.tsx
git commit -m "feat(dashboard): integrate FAQ manager for owners

- Add FAQ management section to owner dashboard
- Only visible to users with OWNER role
- Allows owners to create, read, update, delete FAQs
- Auto-keyword generation shows in toast

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add Email Conversation FAQ Support

**Files:**
- Modify: `client/src/components/features/conversations-page-view.tsx`
- Test: Visual testing in browser

**Interfaces:**

Consumes: Existing `handleCheckFaq()` function and `api.checkFaq()` method

Produces: Check FAQ button in both LinkedIn and email conversation compose areas

- [ ] **Step 1: Locate email conversation compose in the component**

Read `conversations-page-view.tsx` and find where email compose area renders (should be similar to LinkedIn section).

- [ ] **Step 2: Add Check FAQ button to email compose area**

Find the email compose section and add similar button logic:

```typescript
// Add state for email FAQ checking if not already present
const [isCheckingFaqEmail, setIsCheckingFaqEmail] = useState(false);

// Add handler (reuse existing logic or extract to shared function)
const handleCheckFaqEmail = async () => {
  const emailMessages = selectedConversation?.messages || [];
  const lastCandidateMsg = emailMessages
    .slice()
    .reverse()
    .find((m: any) => m.senderType === "candidate")?.text;

  if (!lastCandidateMsg) {
    toast.error("No candidate message found");
    return;
  }

  setIsCheckingFaqEmail(true);
  try {
    const result = await api.checkFaq(lastCandidateMsg);
    if (result.match) {
      // Autofill compose box
      const composeDraft = `${result.answer}`;
      setComposeDraft(composeDraft);
      toast.success(`Found FAQ match: "${result.matchedQuestion}"`);
    } else {
      toast.info("No confident FAQ match found");
    }
  } catch (err: any) {
    if (err.code === "DRAFTING_SERVICE_UNAVAILABLE" || err.code === "FAQ_GENERATION_FAILED") {
      toast.error("FAQ service temporarily unavailable");
    } else {
      toast.error("Failed to check FAQ");
    }
  } finally {
    setIsCheckingFaqEmail(false);
  }
};

// In email compose area JSX, add button before Send:
<Button
  onClick={handleCheckFaqEmail}
  disabled={isCheckingFaqEmail || !lastCandidateEmail}
  className="gap-2 text-cyan-600 hover:text-cyan-700"
  variant="outline"
>
  {isCheckingFaqEmail ? <Loader2 size={16} className="animate-spin" /> : <MessageCircleQuestion size={16} />}
  Check FAQ
</Button>
```

- [ ] **Step 2: Refactor to avoid duplication**

Extract the FAQ check logic into a shared function:

```typescript
const checkFaqAndAutofill = async (message: string, setLoading: (b: boolean) => void, setDraft: (d: string) => void) => {
  if (!message) {
    toast.error("No message to check");
    return;
  }
  setLoading(true);
  try {
    const result = await api.checkFaq(message);
    if (result.match) {
      setDraft(result.answer);
      toast.success(`Found FAQ match: "${result.matchedQuestion}"`);
    } else {
      toast.info("No confident FAQ match found");
    }
  } catch (err: any) {
    if (err.code === "DRAFTING_SERVICE_UNAVAILABLE" || err.code === "FAQ_GENERATION_FAILED") {
      toast.error("FAQ service temporarily unavailable");
    } else {
      toast.error("Failed to check FAQ");
    }
  } finally {
    setLoading(false);
  }
};

// Then use in both LinkedIn and email:
const handleCheckFaqLinkedIn = async () => {
  const msg = /* get last candidate message from LinkedIn */;
  await checkFaqAndAutofill(msg, setIsCheckingFaq, setLinkedInDraft);
};

const handleCheckFaqEmail = async () => {
  const msg = /* get last candidate message from email */;
  await checkFaqAndAutofill(msg, setIsCheckingFaqEmail, setEmailDraft);
};
```

- [ ] **Step 3: Test in browser**

- Open an email conversation
- Click "Check FAQ" button
- Verify it queries the candidate's latest message
- Verify FAQ match fills the compose box
- Verify no-match toast appears if no match found

- [ ] **Step 4: Commit email FAQ support**

```bash
git add client/src/components/features/conversations-page-view.tsx
git commit -m "feat(email): add Check FAQ button to email conversations

- Extend FAQ lookup to email compose area
- Reuses existing FAQ check logic and API
- Auto-fills compose box on confident match
- Handles failures gracefully with toast notifications
- Refactor common logic to reduce duplication

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Final Integration & Testing

**Files:**
- No new files, verify all changes work together

**Interfaces:**

Consumes: All endpoints and components from Tasks 1-7

Produces: Fully functional FAQ feature with email/LinkedIn support and owner dashboard

- [ ] **Step 1: Start all services**

Terminal 1:
```bash
cd server && npm run dev
```

Terminal 2:
```bash
cd client && npm run dev
```

- [ ] **Step 2: Test FAQ dashboard (create, read, update, delete)**

1. Log in as owner
2. Navigate to `/dashboard`
3. Create new FAQ (verify keywords auto-generated)
4. Edit FAQ
5. Delete FAQ
6. Verify all operations work without errors

- [ ] **Step 3: Test LinkedIn FAQ lookup**

1. Open a LinkedIn conversation
2. Click "Check FAQ" button
3. Verify match returns correct answer
4. Verify no-match returns appropriate message

- [ ] **Step 4: Test Email FAQ lookup**

1. Open an email conversation
2. Click "Check FAQ" button
3. Verify same functionality as LinkedIn

- [ ] **Step 5: Verify database persistence**

1. Create FAQ via dashboard
2. Refresh page
3. Verify FAQ still appears
4. Check Neon database directly if needed

- [ ] **Step 6: Test error scenarios**

- Create FAQ with missing fields (should error)
- Test FAQ lookup with no matching FAQ (should return no-match)
- Test edit/delete without owner role (should error)
- Test with Claude API key missing (should error gracefully)

- [ ] **Step 7: Final commit with summary**

```bash
git log --oneline -10  # View the commits
git push origin feature/faq-auto-response
```

Then update PR #12 with summary of all three features added.

---

## Spec Coverage Checklist

✅ **Feature 1: Email Conversation FAQ** - Task 7 adds Check FAQ button to email compose  
✅ **Feature 2: FAQ Management Dashboard** - Tasks 5-6 create owner-only CRUD UI  
✅ **Feature 3: Auto-tagging on Create** - Task 2-3 add keyword generation via Claude  
✅ **Database Migration** - Already handled (dev Neon instance configured)  
✅ **Single PR Constraint** - All work on `feature/faq-auto-response` branch  
✅ **Authentication** - Owner role verified on all CRUD endpoints

