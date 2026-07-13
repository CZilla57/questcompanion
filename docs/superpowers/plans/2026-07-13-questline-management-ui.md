# Questline Management UI (polish + edit/delete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add quests to a questline from its own page, keep quests in completed questlines visible/representable in the Quest Log, and edit/delete a questline (title, description, accent color) — plus a contract tidy-up so the PATCH endpoint matches its partial-update handler.

**Architecture:** Pure frontend + one OpenAPI contract alignment. Reuse the existing natural-language `QuickAddBar` (extended with an optional `questlineId`) for detail-page adds; wire the already-generated `useUpdateQuestline`/`useDeleteQuestline` hooks behind a new edit dialog + a delete confirm on the detail page; broaden the Quest Log's questline option lists. No DB or backend-logic changes.

**Tech Stack:** TypeScript, React 19 + wouter v3 + TanStack Query v5, orval codegen, Tailwind + shadcn/ui, Express (contract only).

## Global Constraints

- **No schema/table changes, no `drizzle push`.** `questlines.color` already exists (nullable text).
- **Contract fix is alignment-only** — do NOT change the `PATCH /questlines/:id` handler; it already treats every field as optional.
- **Questline option lists:** the **create** (new-quest) selector lists **active** questlines only; the **filter** control and the **edit-quest** selector list **all** questlines, with completed ones labeled `"<title> · done"`.
- **Delete** unlinks quests (backend FK `set null` — quests survive as regular quests); the confirm copy must say so; on success navigate to `/questlines`.
- **Color** is chosen from a fixed preset palette (7 hexes) plus **None** (clears to `null`): `#22d3ee` (cyan), `#a78bfa` (violet), `#34d399` (emerald), `#fbbf24` (amber), `#fb7185` (rose), `#38bdf8` (sky), `#a3e635` (lime).
- **wouter v3 idioms:** `<Link href=... className=...>` (no nested `<a>`); programmatic nav via `const [, navigate] = useLocation()` then `navigate("/questlines")`.
- **Codegen:** edit `lib/api-spec/openapi.yaml` → `pnpm --filter @workspace/api-spec codegen`. Never hand-edit `*/src/generated`.
- **Verification:** `pnpm typecheck` (root) is the per-task gate; `pnpm --filter @workspace/api-server test` is a regression guard after the contract change. The authenticated browser walkthrough is controller/user-run (Auth0 login gate).
- Branch: `feat/questline-management-ui` (already created). Verify you are on it before each commit (`git rev-parse --abbrev-ref HEAD`) — concurrent sessions share this working tree.

---

### Task 1: Contract fix — `QuestlineUpdate` schema + PATCH re-point + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (add `QuestlineUpdate` schema; re-point `PATCH /questlines/{id}` requestBody)
- Regenerates: `lib/api-client-react/src/generated/*`, `lib/api-zod/src/generated/*` (via codegen — do not hand-edit)

**Interfaces:**
- Produces: `useUpdateQuestline`'s mutate body becomes `BodyType<QuestlineUpdate>` (all fields optional), consumed by Task 4.

- [ ] **Step 1: Add the `QuestlineUpdate` schema**

In `lib/api-spec/openapi.yaml`, in `components.schemas`, immediately after the `QuestlineInput` schema block, add:

```yaml
    QuestlineUpdate:
      type: object
      description: Partial update — every field optional.
      properties:
        title:
          type: string
          minLength: 1
          maxLength: 120
        description:
          type: ["string", "null"]
        color:
          type: ["string", "null"]
```

- [ ] **Step 2: Point the PATCH endpoint at it**

In `lib/api-spec/openapi.yaml`, find `/questlines/{id}` → `patch:` → `requestBody` → `schema`, and change the `$ref` from `QuestlineInput` to `QuestlineUpdate`:

```yaml
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/QuestlineUpdate"
```

- [ ] **Step 3: Regenerate the client**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: completes without error. Verify the update body type changed:
Run: `grep -n "UpdateQuestlineMutationBody" lib/api-client-react/src/generated/api.ts`
Expected: `export type UpdateQuestlineMutationBody = BodyType<QuestlineUpdate>`

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react lib/api-zod
git commit -m "feat(api): add QuestlineUpdate schema so PATCH questline accepts partial bodies"
```

---

### Task 2: `QuickAddBar` — optional `questlineId` prop

**Files:**
- Modify: `artifacts/focusquest/src/components/quick-add-bar.tsx`

**Interfaces:**
- Consumes: existing `useCreateTask` (already accepts `questlineId`).
- Produces: `QuickAddBar` accepts an optional `questlineId?: number`; when set, created quests attach to that questline and the questline queries refetch. Consumed by Task 4.

- [ ] **Step 1: Extend the query-key imports**

In `artifacts/focusquest/src/components/quick-add-bar.tsx`, change the import line:

```ts
import { useCreateTask, useParseQuickAdd, getGetTasksQueryKey } from "@workspace/api-client-react";
```

to:

```ts
import { useCreateTask, useParseQuickAdd, getGetTasksQueryKey, getGetQuestlinesQueryKey, getGetQuestlineQueryKey } from "@workspace/api-client-react";
```

- [ ] **Step 2: Add the prop**

Change the component signature:

```ts
export function QuickAddBar({ selectedDate }: { selectedDate: Date | undefined }) {
```

to:

```ts
export function QuickAddBar({ selectedDate, questlineId }: { selectedDate: Date | undefined; questlineId?: number }) {
```

- [ ] **Step 3: Send `questlineId` on create and refetch questline queries**

In `handleCreate`, add `questlineId` to the create payload's `data` object (after the `category` spread line):

```ts
        ...(parsed.category ? { category: parsed.category as any } : {}),
        ...(questlineId != null ? { questlineId } : {}),
```

Then in that mutation's `onSuccess`, after the existing `invalidateQueries({ queryKey: getGetTasksQueryKey() })`, add:

```ts
        if (questlineId != null) {
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(questlineId) });
        }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (The existing bare `<QuickAddBar selectedDate={date} />` in `tasks.tsx` still typechecks — the new prop is optional.)

- [ ] **Step 5: Commit**

```bash
git add artifacts/focusquest/src/components/quick-add-bar.tsx
git commit -m "feat(web): let QuickAddBar attach new quests to a questline"
```

---

### Task 3: Quest Log — show completed questlines in filter + edit selector

**Files:**
- Modify: `artifacts/focusquest/src/pages/tasks.tsx`

**Interfaces:**
- Consumes: `useGetQuestlines` (existing import).
- Produces: filter + edit selectors list all questlines (completed labeled); create selector lists active only.

- [ ] **Step 1: Load all questlines and derive the active subset**

In `artifacts/focusquest/src/pages/tasks.tsx`, change the questlines query (currently at ~line 263):

```ts
  const { data: questlines } = useGetQuestlines({ status: "active" });
```

to:

```ts
  const { data: questlines } = useGetQuestlines();
  const activeQuestlines = (questlines ?? []).filter((q) => q.status === "active");
```

- [ ] **Step 2: Filter control lists all questlines, completed labeled**

In the questline **filter** `<Select>` (the `SelectItem` map at ~line 470), change the option label to mark completed questlines. Replace:

```tsx
            {(questlines ?? []).map((ql) => (
              <SelectItem key={ql.id} value={String(ql.id)}>{ql.title}</SelectItem>
            ))}
```

with:

```tsx
            {(questlines ?? []).map((ql) => (
              <SelectItem key={ql.id} value={String(ql.id)}>
                {ql.title}{ql.status === "completed" ? " · done" : ""}
              </SelectItem>
            ))}
```

- [ ] **Step 3: Create (new-quest) selector lists ACTIVE questlines only**

In the **create** dialog's questline `<Select>` (the `SelectItem` map at ~line 638, under the "Questline (optional)" label that precedes the `newTaskQuestlineId` select), change `(questlines ?? [])` to `activeQuestlines`:

```tsx
                  {activeQuestlines.map((ql) => (
                    <SelectItem key={ql.id} value={String(ql.id)}>{ql.title}</SelectItem>
                  ))}
```

- [ ] **Step 4: Edit selector lists all questlines, completed labeled**

In the **edit** dialog's questline `<Select>` (the `SelectItem` map at ~line 753, under the "Questline (optional)" label that precedes the `editQuestlineId` select), change to list all with the done label:

```tsx
                  {(questlines ?? []).map((ql) => (
                    <SelectItem key={ql.id} value={String(ql.id)}>
                      {ql.title}{ql.status === "completed" ? " · done" : ""}
                    </SelectItem>
                  ))}
```

> Read the two dialogs first to confirm which `<Select>` binds `newTaskQuestlineId` (create → active) vs `editQuestlineId` (edit → all). Do not swap them.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/focusquest/src/pages/tasks.tsx
git commit -m "feat(web): show completed questlines in the Quest Log filter and edit selector"
```

---

### Task 4: Detail page — quick-add, edit dialog, delete confirm

**Files:**
- Create: `artifacts/focusquest/src/components/questline-edit-dialog.tsx`
- Modify: `artifacts/focusquest/src/pages/questline-detail.tsx`

**Interfaces:**
- Consumes: `QuickAddBar` with `questlineId` (Task 2); `useUpdateQuestline` with `QuestlineUpdate` body (Task 1); `useDeleteQuestline`; wouter `useLocation`.
- Produces: the finished detail page (add + edit + delete).

- [ ] **Step 1: Create the edit dialog component**

Create `artifacts/focusquest/src/components/questline-edit-dialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Questline,
  useUpdateQuestline,
  getGetQuestlineQueryKey,
  getGetQuestlinesQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// Preset accent palette (theme-aligned); "None" clears the color to null.
const QUESTLINE_COLORS = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#38bdf8", "#a3e635"];

export function QuestlineEditDialog({
  questline,
  open,
  onOpenChange,
}: {
  questline: Questline;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateMutation = useUpdateQuestline();

  const [title, setTitle] = useState(questline.title);
  const [description, setDescription] = useState(questline.description ?? "");
  const [color, setColor] = useState<string | null>(questline.color ?? null);

  // Re-seed the form whenever a different questline (or fresh open) drives the dialog.
  useEffect(() => {
    if (open) {
      setTitle(questline.title);
      setDescription(questline.description ?? "");
      setColor(questline.color ?? null);
    }
  }, [open, questline.id, questline.title, questline.description, questline.color]);

  const handleSave = () => {
    if (!title.trim()) return;
    updateMutation.mutate(
      { id: questline.id, data: { title: title.trim(), description: description.trim() || null, color } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(questline.id) });
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          onOpenChange(false);
          toast({ title: "Questline updated", className: "border-primary" });
        },
        onError: (err: any) => {
          toast({ title: err?.response?.data?.error ?? "Could not update questline", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Questline</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div>
            <label className="text-sm text-muted-foreground">Accent color</label>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {QUESTLINE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? "ring-2 ring-offset-2 ring-offset-background ring-foreground scale-110" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <button
                type="button"
                aria-label="No color"
                onClick={() => setColor(null)}
                className={`px-3 h-7 rounded-full border text-xs ${color == null ? "border-foreground text-foreground" : "border-border text-muted-foreground"}`}
              >
                None
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!title.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire the detail page — imports and state**

In `artifacts/focusquest/src/pages/questline-detail.tsx`, update the imports:

Change the wouter import line:
```tsx
import { useRoute, Link } from "wouter";
```
to:
```tsx
import { useRoute, useLocation, Link } from "wouter";
```

Add `Pencil` and `Trash2` to the lucide import:
```tsx
import { ArrowLeft, Scroll, Trophy, Pencil, Trash2 } from "lucide-react";
```

Extend the api-client import to add `useDeleteQuestline`:
```tsx
import {
  useGetQuestline,
  useClaimQuestline,
  useDeleteQuestline,
  getGetQuestlineQueryKey,
  getGetQuestlinesQueryKey,
  getGetMyStatsQueryKey,
} from "@workspace/api-client-react";
```

Add these component imports below the existing ones:
```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuickAddBar } from "@/components/quick-add-bar";
import { QuestlineEditDialog } from "@/components/questline-edit-dialog";
import { useState } from "react";
```

Inside the component, after the existing `useState`/hooks (below the `claimMutation` line), add:
```tsx
  const [, navigate] = useLocation();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMutation = useDeleteQuestline();

  const handleDelete = () => {
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
        toast({ title: "Questline deleted", variant: "destructive" });
        navigate("/questlines");
      },
      onError: (err: any) => {
        toast({ title: err?.response?.data?.error ?? "Could not delete questline", variant: "destructive" });
      },
    });
  };
```

- [ ] **Step 3: Add header actions (Edit + Delete)**

In the header block, replace the title row:

```tsx
        <div className="flex items-center gap-2">
          <Scroll className="w-5 h-5 text-primary" style={questline.color ? { color: questline.color } : undefined} />
          <h1 className="text-xl font-bold">{questline.title}</h1>
        </div>
```

with a row that includes the actions:

```tsx
        <div className="flex items-center gap-2">
          <Scroll className="w-5 h-5 text-primary shrink-0" style={questline.color ? { color: questline.color } : undefined} />
          <h1 className="text-xl font-bold flex-1 min-w-0 truncate">{questline.title}</h1>
          <Button variant="ghost" size="icon" aria-label="Edit questline" className="h-8 w-8 shrink-0" onClick={() => setEditOpen(true)}>
            <Pencil className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Delete questline" className="h-8 w-8 shrink-0 hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
```

- [ ] **Step 4: Add the quick-add bar above the quests list**

Replace the quests section:

```tsx
      {quests.length === 0 ? (
        <p className="text-muted-foreground text-center py-8">
          No quests yet. Assign quests to this questline from the Quest Log.
        </p>
      ) : (
        <div className="space-y-3">
          {quests.map((task) => <TaskItem key={task.id} task={task} />)}
        </div>
      )}
```

with:

```tsx
      <div className="mb-4">
        <QuickAddBar selectedDate={new Date()} questlineId={questline.id} />
      </div>

      {quests.length === 0 ? (
        <p className="text-muted-foreground text-center py-6">
          No quests yet — add one above to start this questline.
        </p>
      ) : (
        <div className="space-y-3">
          {quests.map((task) => <TaskItem key={task.id} task={task} />)}
        </div>
      )}
```

- [ ] **Step 5: Render the edit dialog and the delete confirm**

Immediately before the final closing `</div>` of the component's returned tree, add:

```tsx
      <QuestlineEditDialog questline={questline} open={editOpen} onOpenChange={setEditOpen} />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete this questline?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Its {questline.total} quest{questline.total === 1 ? "" : "s"} will be unlinked (kept as regular quests), and this questline will be removed.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/focusquest/src/components/questline-edit-dialog.tsx artifacts/focusquest/src/pages/questline-detail.tsx
git commit -m "feat(web): add quest-add, edit, and delete to the questline detail page"
```

- [ ] **Step 8: End-to-end verification (controller/user-run — Auth0 gate)**

With the app running, on `/questlines/:id`:
1. Type a line into the quick-add bar (e.g. "Long run saturday 8am") → the quest appears in the list and the progress `done/total` denominator increments.
2. Click the pencil → change the title and pick a color swatch → Save → header title + `Scroll` accent update immediately.
3. Complete all quests → the Claim button appears (regression check of the prior fix) → claim fires the celebration.
4. Click the trash → confirm → you land on `/questlines`, and the quests still exist (now unlinked) in the Quest Log.
5. In the Quest Log, filter by the completed questline → its quests show (labeled "· done" in the dropdown).

- [ ] **Step 9: Regression gate**

Run:
```bash
pnpm typecheck
pnpm --filter @workspace/api-server test
```
Expected: typecheck PASS; api-server suite green (unchanged backend).

---

## Self-Review

**Spec coverage** — every spec section maps to a task:
- Detail-page quick-add (spec §1) → Task 2 (prop) + Task 4 Step 4.
- Completed-questline visibility (spec §2) → Task 3.
- Edit questline dialog + color swatches (spec §3) → Task 4 Step 1 + Step 3/5.
- Delete questline + confirm + navigate (spec §4) → Task 4 Step 2/5.
- `QuestlineUpdate` contract fix (spec §5) → Task 1.
- No schema change → confirmed: no task touches `lib/db` or runs `drizzle push`.

**Placeholder scan** — no TBD/TODO; every code step is complete. Approximate line numbers in Task 3 are anchored by content (which `<Select>` binds `newTaskQuestlineId` vs `editQuestlineId`), with an explicit "don't swap them" caution.

**Type consistency** — `questlineId?: number` prop (Task 2) matches the `questline.id: number` passed in Task 4. `useUpdateQuestline` body is `QuestlineUpdate` after Task 1, consumed with `{ title, description, color }` in Task 4 (all optional → valid). `getGetQuestlineQueryKey(id: number)` / `getGetQuestlinesQueryKey()` call shapes match their generated signatures and the existing detail-page usage. `useDeleteQuestline` mutate takes `{ id: number }` (verified against the generated hook). Color state is `string | null`, matching `color: ["string","null"]` in the contract.

**Ordering** — Task 1 (contract) precedes Task 4 (which consumes the partial-update body); Task 2 (QuickAddBar prop) precedes Task 4 Step 4 (which passes the prop). Tasks 2 and 3 are independent of each other.
