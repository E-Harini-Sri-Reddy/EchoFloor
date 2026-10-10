import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { membershipAllowsLogin, workerAccessTypeOf } from "@/domain/access";
import {
  labelTaskPriority,
  labelTaskStatus,
  labelWorkerAccessType,
} from "@/domain/labels";
import {
  activeWorkerRows,
  machineById,
  machinesFor,
  tasksFor,
  userById,
} from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { demoStore } from "@/services/demoStore";
import type { Task, TaskPriority, TaskStatus } from "@/types/domain";
import { formatTimestamp } from "@/utils/format";

export function AdminTasksPage() {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const [params] = useSearchParams();
  const focusTaskId = params.get("task");
  const workers = session ? activeWorkerRows(db, session.organisationId) : [];
  const machines = session ? machinesFor(db, session.organisationId) : [];
  const [assigneeUserId, setAssigneeUserId] = useState(workers[0]?.membership.userId ?? "");
  const [machineId, setMachineId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueAt, setDueAt] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<"openish" | "all">("openish");
  useEffect(() => {
    if (!focusTaskId) return;
    const node = document.getElementById(`task-${focusTaskId}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusTaskId]);
  if (!session) return null;

  const timezone =
    db.organisations.find((item) => item.id === session.organisationId)?.settings
      .timezone ?? "UTC";
  const tasks =
    filter === "openish"
      ? tasksFor(db, session.organisationId, { status: "openish" })
      : tasksFor(db, session.organisationId);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const result = demoStore.createTask({
      assigneeUserId,
      machineId,
      title,
      description,
      priority,
      dueAt: dueAt || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast.push(result.message);
      return;
    }
    setErrors({});
    setTitle("");
    setDescription("");
    setDueAt("");
    setPriority("medium");
    toast.push("Task assigned in this browser session. It was not written to MongoDB.");
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Tasks</h2>
          <p className="lede">
            Assign work to permanent or temporary workers and set a priority. These are
            browser-session records, not live plant work orders.
          </p>
        </div>
      </header>
      <form className="card form-grid" onSubmit={onSubmit} noValidate>
        <h3>Assign a task</h3>
        <Field
          label="Worker"
          htmlFor="task-assignee"
          error={errors.assigneeUserId}
        >
          <select
            id="task-assignee"
            value={assigneeUserId}
            onChange={(event) => setAssigneeUserId(event.target.value)}
          >
            <option value="">Select a worker</option>
            {workers.map(({ membership, user }) => (
              <option key={membership.id} value={membership.userId}>
                {user?.displayName} · {labelWorkerAccessType(workerAccessTypeOf(membership))}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priority" htmlFor="task-priority" error={errors.priority}>
          <select
            id="task-priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </Field>
        <Field label="Machine (optional)" htmlFor="task-machine" error={errors.machineId}>
          <select
            id="task-machine"
            value={machineId}
            onChange={(event) => setMachineId(event.target.value)}
          >
            <option value="">No specific machine</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.machineCode} — {machine.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" htmlFor="task-title" error={errors.title}>
          <TextInput
            id="task-title"
            value={title}
            error={errors.title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field
          label="Description (optional)"
          htmlFor="task-description"
          error={errors.description}
        >
          <textarea
            id="task-description"
            value={description}
            aria-invalid={errors.description ? true : undefined}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field label="Due (optional)" htmlFor="task-due" error={errors.dueAt}>
          <TextInput
            id="task-due"
            type="datetime-local"
            value={dueAt}
            error={errors.dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        </Field>
        <Button type="submit" loading={saving} disabled={workers.length === 0}>
          Assign task
        </Button>
        {workers.length === 0 ? (
          <p className="muted">Add an active worker in Settings before assigning tasks.</p>
        ) : null}
      </form>
      <div className="spread">
        <h3>Assigned tasks</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={filter === "openish"}
            onChange={(event) => setFilter(event.target.checked ? "openish" : "all")}
          />
          Open and in progress only
        </label>
      </div>
      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks match"
          message="Assigned tasks for this organisation will appear here."
        />
      ) : (
        <div className="stack">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              timezone={timezone}
              showAssignee
              canCancel
              highlighted={task.id === focusTaskId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkerTasksPage() {
  const db = useDemoDatabase();
  const session = db.session;
  const [params] = useSearchParams();
  const focusTaskId = params.get("task");
  useEffect(() => {
    if (!focusTaskId) return;
    const node = document.getElementById(`task-${focusTaskId}`);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusTaskId]);
  if (!session) return null;
  const timezone =
    db.organisations.find((item) => item.id === session.organisationId)?.settings
      .timezone ?? "UTC";
  const openTasks = tasksFor(db, session.organisationId, {
    assigneeUserId: session.userId,
    status: "openish",
  });
  const otherTasks = tasksFor(db, session.organisationId, {
    assigneeUserId: session.userId,
  }).filter((task) => task.status === "completed" || task.status === "cancelled");

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>My tasks</h2>
          <p className="lede">
            Work assigned to you by an administrator, with priority. Completing a task
            here only updates this browser session. Starting work clears the task from
            the notification badge.
          </p>
        </div>
      </header>
      <h3>Open</h3>
      {openTasks.length === 0 ? (
        <EmptyState
          title="No open tasks"
          message="When an administrator assigns work to you, it appears here."
        />
      ) : (
        <div className="stack">
          {openTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              timezone={timezone}
              highlighted={task.id === focusTaskId}
            />
          ))}
        </div>
      )}
      {otherTasks.length > 0 ? (
        <>
          <h3>Completed or cancelled</h3>
          <div className="stack">
            {otherTasks.map((task) => (
              <TaskCard key={task.id} task={task} timezone={timezone} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TaskCard({
  task,
  timezone,
  showAssignee = false,
  canCancel = false,
  highlighted = false,
}: {
  task: Task;
  timezone: string;
  showAssignee?: boolean;
  canCancel?: boolean;
  highlighted?: boolean;
}) {
  const db = useDemoDatabase();
  const toast = useToast();
  const [busy, setBusy] = useState<TaskStatus | null>(null);
  const assignee = userById(db, task.assigneeUserId);
  const assigner = userById(db, task.assignedBy);
  const machine = task.machineId
    ? machineById(db, task.organisationId, task.machineId)
    : null;
  const membership = db.memberships.find(
    (item) =>
      item.userId === task.assigneeUserId &&
      item.organisationId === task.organisationId,
  );
  const tasksPath =
    db.session?.role === "admin" ? "/admin/tasks" : "/worker/tasks";

  async function setStatus(status: TaskStatus) {
    setBusy(status);
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    const result = demoStore.updateTaskStatus(task.id, status);
    setBusy(null);
    if (!result.ok) {
      toast.push(result.message);
      return;
    }
    const cleared =
      status === "in_progress" || status === "completed" || status === "cancelled";
    toast.push(
      cleared
        ? `Task marked ${labelTaskStatus(status).toLowerCase()}. It left the notification badge.`
        : `Task marked ${labelTaskStatus(status).toLowerCase()} in this session.`,
      cleared ? { to: `${tasksPath}?task=${encodeURIComponent(task.id)}` } : undefined,
    );
  }

  return (
    <article
      id={`task-${task.id}`}
      className={highlighted ? "card stack is-highlighted" : "card stack"}
    >
      <div className="spread">
        <strong>{task.title}</strong>
        <div className="row">
          <StatusBadge
            status={task.priority}
            label={`Priority: ${labelTaskPriority(task.priority)}`}
          />
          <StatusBadge status={task.status} label={labelTaskStatus(task.status)} />
        </div>
      </div>
      {task.description ? <p>{task.description}</p> : null}
      <p className="muted">
        {showAssignee ? (
          <>
            Assigned to {assignee?.displayName ?? "Unknown"}
            {membership && membershipAllowsLogin(membership)
              ? ` (${labelWorkerAccessType(workerAccessTypeOf(membership))})`
              : ""}
            {" · "}
          </>
        ) : (
          <>From {assigner?.displayName ?? "Administrator"} · </>
        )}
        {machine ? (
          <>
            <span className="mono">{machine.machineCode}</span> — {machine.name} ·{" "}
          </>
        ) : null}
        {task.dueAt ? <>Due {formatTimestamp(task.dueAt, timezone)} · </> : null}
        Created {formatTimestamp(task.createdAt, timezone)}
      </p>
      <div className="row">
        {task.status === "open" ? (
          <Button
            variant="secondary"
            loading={busy === "in_progress"}
            onClick={() => void setStatus("in_progress")}
          >
            Start
          </Button>
        ) : null}
        {task.status === "open" || task.status === "in_progress" ? (
          <Button
            loading={busy === "completed"}
            onClick={() => void setStatus("completed")}
          >
            Mark completed
          </Button>
        ) : null}
        {canCancel && (task.status === "open" || task.status === "in_progress") ? (
          <Button
            variant="tertiary"
            loading={busy === "cancelled"}
            onClick={() => void setStatus("cancelled")}
          >
            Cancel
          </Button>
        ) : null}
        {machine && db.session?.role === "worker" ? (
          <Link to={`/worker/voice?machine=${machine.id}`}>Open voice for machine</Link>
        ) : null}
      </div>
    </article>
  );
}
