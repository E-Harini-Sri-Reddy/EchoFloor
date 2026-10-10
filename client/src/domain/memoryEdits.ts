import type {
  EditableMemory,
  FieldChange,
  MemoryRecord,
  MemoryType,
  MemoryStatus,
} from "@/types/domain";

export function memoryToEditable(memory: MemoryRecord): EditableMemory {
  return {
    title: memory.title,
    content: memory.content,
    summary: memory.summary ?? "",
    status: memory.status,
    type: memory.type,
    tags: memory.tags.join(", "),
    component: memory.machineContext?.component ?? "",
    operatingConditions: memory.machineContext?.operatingConditions?.join(", ") ?? "",
  };
}

function normalizeList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function diffMemoryEdit(
  current: MemoryRecord,
  draft: EditableMemory,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const compare = (field: string, label: string, before: string, after: string) => {
    if (before !== after) {
      changes.push({ field, label, before, after });
    }
  };

  compare("title", "Title", current.title, draft.title.trim());
  compare("content", "Record", current.content, draft.content.trim());
  compare("summary", "Summary", current.summary ?? "", draft.summary.trim());
  compare("status", "Status", current.status, draft.status);
  compare("type", "Type", current.type, draft.type);
  compare("tags", "Tags", current.tags.join(", "), normalizeList(draft.tags).join(", "));
  compare(
    "component",
    "Component",
    current.machineContext?.component ?? "",
    draft.component.trim(),
  );
  compare(
    "operatingConditions",
    "Operating conditions",
    current.machineContext?.operatingConditions?.join(", ") ?? "",
    normalizeList(draft.operatingConditions).join(", "),
  );
  return changes;
}

export function applyDraft(current: MemoryRecord, draft: EditableMemory): MemoryRecord {
  const conditions = normalizeList(draft.operatingConditions);
  const component = draft.component.trim();
  return {
    ...current,
    title: draft.title.trim(),
    content: draft.content.trim(),
    summary: draft.summary.trim() || undefined,
    status: draft.status,
    type: draft.type,
    tags: normalizeList(draft.tags),
    machineContext:
      component || conditions.length > 0
        ? {
            ...current.machineContext,
            component: component || undefined,
            operatingConditions: conditions.length > 0 ? conditions : undefined,
          }
        : current.machineContext,
  };
}

export function validateMemoryDraft(draft: EditableMemory): Record<string, string> {
  const errors: Record<string, string> = {};
  if (draft.title.trim().length < 3) {
    errors.title = "Enter a title of at least 3 characters.";
  }
  if (draft.content.trim().length < 12) {
    errors.content = "Describe the record in at least 12 characters.";
  }
  return errors;
}

export const MEMORY_TYPES: MemoryType[] = [
  "incident",
  "troubleshooting",
  "maintenance",
  "observation",
  "operational_note",
  "handover_note",
];

export const MEMORY_STATUSES: MemoryStatus[] = [
  "pending_review",
  "verified",
  "unresolved",
  "resolved",
  "superseded",
  "archived",
];
