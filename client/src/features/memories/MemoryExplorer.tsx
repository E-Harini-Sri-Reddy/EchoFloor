import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, TextInput } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import {
  MEMORY_STATUSES,
  MEMORY_TYPES,
  diffMemoryEdit,
  memoryToEditable,
  validateMemoryDraft,
} from "@/domain/memoryEdits";
import { labelMemoryStatus, labelMemoryType } from "@/domain/labels";
import {
  filterMemories,
  machineById,
  machinesFor,
  memoryById,
  revisionsFor,
  userById,
} from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { demoStore } from "@/services/demoStore";
import type { EditableMemory, MemoryStatus, MemoryType } from "@/types/domain";
import { delay, formatTimestamp, paginate } from "@/utils/format";

export function MemoryExplorerPage() {
  const db = useDemoDatabase();
  const session = db.session;
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  if (!session) return null;
  const machines = machinesFor(db, session.organisationId);
  const query = {
    text: params.get("q") ?? "",
    machineId: params.get("machine") ?? "all",
    type: (params.get("type") ?? "all") as MemoryType | "all",
    status: (params.get("status") ?? "all") as MemoryStatus | "all",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const results = filterMemories(db, session.organisationId, query);
  const paged = paginate(results, page, 6);
  const timezone =
    db.organisations.find((item) => item.id === session.organisationId)?.settings
      .timezone ?? "UTC";

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next);
    setPage(1);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Memory Explorer</h2>
          <p className="lede">
            Administrator review of example records in this session. Search runs locally
            and stays inside the active organisation.
          </p>
        </div>
      </header>
      <div className="filter-bar">
        <Field label="Search memories" htmlFor="memory-search">
          <TextInput
            id="memory-search"
            value={query.text}
            placeholder="pressure, seal, humidity"
            onChange={(event) => update("q", event.target.value)}
          />
        </Field>
        <Field label="Machine" htmlFor="memory-machine">
          <select
            id="memory-machine"
            value={query.machineId}
            onChange={(event) => update("machine", event.target.value)}
          >
            <option value="all">All machines</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.machineCode}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type" htmlFor="memory-type">
          <select
            id="memory-type"
            value={query.type}
            onChange={(event) => update("type", event.target.value)}
          >
            <option value="all">All types</option>
            {MEMORY_TYPES.map((type) => (
              <option key={type} value={type}>
                {labelMemoryType(type)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" htmlFor="memory-status">
          <select
            id="memory-status"
            value={query.status}
            onChange={(event) => update("status", event.target.value)}
          >
            <option value="all">All statuses</option>
            {MEMORY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {labelMemoryStatus(status)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="filter-bar">
        <Field label="From" htmlFor="memory-from">
          <TextInput
            id="memory-from"
            type="date"
            value={query.from}
            onChange={(event) => update("from", event.target.value)}
          />
        </Field>
        <Field label="To" htmlFor="memory-to">
          <TextInput
            id="memory-to"
            type="date"
            value={query.to}
            onChange={(event) => update("to", event.target.value)}
          />
        </Field>
      </div>
      {paged.total === 0 ? (
        <EmptyState
          title="No memories found"
          message="No example records match these filters in the active organisation."
        />
      ) : (
        <div className="stack">
          {paged.items.map((memory) => {
            const machine = machineById(db, session.organisationId, memory.machineId);
            return (
              <Link
                key={memory.id}
                className="list-card"
                to={`/admin/memories/${memory.id}`}
              >
                <div className="spread">
                  <strong>{memory.title}</strong>
                  <StatusBadge
                    status={memory.status}
                    label={labelMemoryStatus(memory.status)}
                  />
                </div>
                <span className="mono">{machine?.machineCode ?? "Unknown machine"}</span>
                <span className="muted">
                  {labelMemoryType(memory.type)} · revision {memory.currentRevision} ·{" "}
                  {formatTimestamp(memory.updatedAt, timezone)}
                  {memory.example ? " · Example historical knowledge" : ""}
                </span>
              </Link>
            );
          })}
          <div className="row">
            <Button
              variant="secondary"
              disabled={paged.page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </Button>
            <span className="muted">
              Page {paged.page} of {paged.pageCount} · {paged.total} records
            </span>
            <Button
              variant="secondary"
              disabled={paged.page >= paged.pageCount}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MemoryDetailPage() {
  const { memoryId = "" } = useParams();
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const memory = session ? memoryById(db, session.organisationId, memoryId) : null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditableMemory | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const changes = useMemo(
    () => (memory && draft ? diffMemoryEdit(memory, draft) : []),
    [memory, draft],
  );

  if (!session) return null;
  if (!memory) {
    return (
      <div className="page">
        <EmptyState
          title="Memory not found"
          message="That record is not in the active organisation."
        />
      </div>
    );
  }

  const machine = machineById(db, session.organisationId, memory.machineId);
  const revisions = revisionsFor(db, session.organisationId, memory.id);
  const author = userById(db, memory.source.submittedBy ?? memory.createdBy);
  const timezone =
    db.organisations.find((item) => item.id === session.organisationId)?.settings
      .timezone ?? "UTC";
  const form = draft ?? memoryToEditable(memory);

  function beginEdit() {
    setDraft(memoryToEditable(memory!));
    setErrors({});
    setEditing(true);
  }

  function requestSave() {
    const nextErrors = validateMemoryDraft(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (diffMemoryEdit(memory!, form).length === 0) {
      toast.push("There are no changes to save.");
      return;
    }
    setConfirming(true);
  }

  async function confirmSave() {
    if (!memory) return;
    setSaving(true);
    await delay(400);
    const result = demoStore.updateMemory(
      memory.id,
      form,
      memory.currentRevision,
      diffMemoryEdit(memory, form),
    );
    setSaving(false);
    if (!result.ok) {
      toast.push(result.message);
      return;
    }
    setConfirming(false);
    setEditing(false);
    setDraft(null);
    toast.push(
      "Memory updated in this browser session. No embedding provider was called, so search freshness is not regenerated.",
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="muted">
            <Link to="/admin/memories">Memory Explorer</Link>
          </p>
          <h2>{memory.title}</h2>
          <p className="lede">
            <span className="mono">{machine?.machineCode}</span> — {machine?.name} ·
            revision {memory.currentRevision}
          </p>
        </div>
        <div className="row">
          <StatusBadge status={memory.status} label={labelMemoryStatus(memory.status)} />
          {memory.status !== "verified" ? (
            <StatusBadge status="pending_review" label="Not verified" />
          ) : null}
          {!editing ? (
            <Button onClick={beginEdit}>Edit</Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setDraft(null);
                toast.push("Edit mode closed. The saved record was not changed.");
              }}
            >
              Close edit
            </Button>
          )}
        </div>
      </header>
      {memory.example ? (
        <p className="notice">
          Example historical knowledge. This is not a live machine condition.
        </p>
      ) : (
        <p className="notice notice-info">Saved in this browser session only.</p>
      )}
      {editing ? (
        <form
          className="card form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            requestSave();
          }}
        >
          <Field label="Title" htmlFor="edit-title" error={errors.title}>
            <TextInput
              id="edit-title"
              value={form.title}
              error={errors.title}
              onChange={(event) => setDraft({ ...form, title: event.target.value })}
            />
          </Field>
          <Field label="Record" htmlFor="edit-content" error={errors.content}>
            <textarea
              id="edit-content"
              value={form.content}
              aria-invalid={errors.content ? true : undefined}
              onChange={(event) => setDraft({ ...form, content: event.target.value })}
            />
          </Field>
          <Field label="Summary" htmlFor="edit-summary">
            <TextInput
              id="edit-summary"
              value={form.summary}
              onChange={(event) => setDraft({ ...form, summary: event.target.value })}
            />
          </Field>
          <Field label="Type" htmlFor="edit-type">
            <select
              id="edit-type"
              value={form.type}
              onChange={(event) =>
                setDraft({ ...form, type: event.target.value as MemoryType })
              }
            >
              {MEMORY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {labelMemoryType(type)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="edit-status">
            <select
              id="edit-status"
              value={form.status}
              onChange={(event) =>
                setDraft({ ...form, status: event.target.value as MemoryStatus })
              }
            >
              {MEMORY_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {labelMemoryStatus(status)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tags" htmlFor="edit-tags" hint="Comma-separated">
            <TextInput
              id="edit-tags"
              value={form.tags}
              onChange={(event) => setDraft({ ...form, tags: event.target.value })}
            />
          </Field>
          <Field label="Component" htmlFor="edit-component">
            <TextInput
              id="edit-component"
              value={form.component}
              onChange={(event) => setDraft({ ...form, component: event.target.value })}
            />
          </Field>
          <Field
            label="Operating conditions"
            htmlFor="edit-conditions"
            hint="Comma-separated recorded conditions, not live readings"
          >
            <TextInput
              id="edit-conditions"
              value={form.operatingConditions}
              onChange={(event) =>
                setDraft({ ...form, operatingConditions: event.target.value })
              }
            />
          </Field>
          <Button type="submit">Save changes</Button>
        </form>
      ) : (
        <article className="card stack">
          <p>{memory.content}</p>
          {memory.summary ? <p className="muted">Summary: {memory.summary}</p> : null}
          <p className="muted">
            {labelMemoryType(memory.type)} · source {memory.source.type} ·{" "}
            {author?.displayName ?? "Unknown"} · created{" "}
            {formatTimestamp(memory.createdAt, timezone)}
          </p>
          {memory.machineContext?.component ? (
            <p>Component: {memory.machineContext.component}</p>
          ) : null}
          {memory.machineContext?.operatingConditions ? (
            <p>
              Recorded conditions: {memory.machineContext.operatingConditions.join(", ")}
            </p>
          ) : null}
          {memory.resolution ? (
            <p>Recorded resolution: {memory.resolution.description}</p>
          ) : (
            <p className="muted">No resolution is recorded.</p>
          )}
        </article>
      )}
      <section className="stack">
        <h3>Revision history</h3>
        {revisions.length === 0 ? (
          <EmptyState
            title="No revisions"
            message="Revisions appear when a record is created or confirmed."
          />
        ) : (
          <ol className="timeline">
            {revisions.map((revision) => (
              <li key={revision.id} className="card">
                <strong>Revision {revision.revisionNumber}</strong>
                <p>{revision.changeSummary}</p>
                <p className="muted">
                  {revision.snapshot.title} ·{" "}
                  {formatTimestamp(revision.createdAt, timezone)} ·{" "}
                  {userById(db, revision.changedBy)?.displayName ?? "Unknown"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <Dialog
        open={confirming}
        title="Confirm memory update"
        onCancel={() => {
          if (saving) return;
          setConfirming(false);
          toast.push("Changes canceled.");
        }}
      >
        <p>
          You are about to update <strong>{memory.title}</strong> on{" "}
          <span className="mono">{machine?.machineCode}</span> ({memory.id}). The saved
          record stays unchanged until you confirm.
        </p>
        <ul className="change-list">
          {changes.map((change) => (
            <li key={change.field}>
              <strong>{change.label}</strong>
              <div className="muted">From: {change.before || "Empty"}</div>
              <div>To: {change.after || "Empty"}</div>
            </li>
          ))}
        </ul>
        <p className="muted">
          This preview writes only to the browser session. It does not call the API.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(false);
              toast.push("Changes canceled.");
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={() => void confirmSave()} loading={saving}>
            Confirm update
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
