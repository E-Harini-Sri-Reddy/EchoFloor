import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { isDailyWorkLogMemory } from "@/domain/access";
import { machinesFor } from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { apiCreateDailyWorkLog } from "@/services/apiClient";
import { demoStore } from "@/services/demoStore";
import { formatTimestamp } from "@/utils/format";

function todayLocalDateInput(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

export function AddWorkLogPage() {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const machines = session ? machinesFor(db, session.organisationId) : [];
  const [machineId, setMachineId] = useState(
    params.get("machine") || db.selectedMachineId || machines[0]?.id || "",
  );
  const [workDate, setWorkDate] = useState(todayLocalDateInput());
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const recentLogs = useMemo(() => {
    if (!session) return [];
    return db.memories
      .filter(
        (memory) =>
          memory.organisationId === session.organisationId &&
          memory.createdBy === session.userId &&
          isDailyWorkLogMemory(memory),
      )
      .slice(0, 8);
  }, [db.memories, session]);

  if (!session) return null;
  const activeSession = session;
  const timezone =
    db.organisations.find((item) => item.id === activeSession.organisationId)?.settings
      .timezone ?? "UTC";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});

    const payload = {
      machineId,
      title,
      content,
      workDate: workDate ? new Date(`${workDate}T12:00:00`).toISOString() : undefined,
    };

    if (activeSession.live) {
      const remote = await apiCreateDailyWorkLog({
        organisationId: activeSession.organisationId,
        submittedBy: activeSession.userId,
        ...payload,
      });
      setSaving(false);
      if (!remote.ok) {
        setErrors(remote.fieldErrors ?? {});
        toast.push(remote.message);
        return;
      }
      demoStore.hydrateLive(remote.data.workspace, remote.data.session);
      toast.push("Work log saved to the database.");
      setTitle("");
      setContent("");
      navigate("/worker/dashboard");
      return;
    }

    const local = demoStore.createDailyWorkLog(payload);
    setSaving(false);
    if (!local.ok) {
      setErrors(local.fieldErrors ?? {});
      toast.push(local.message);
      return;
    }
    toast.push("Work log saved in this browser session.");
    setTitle("");
    setContent("");
    navigate("/worker/dashboard");
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Log today’s work</h2>
          <p className="lede">
            Manually record what you did on a machine today. These notes feed daily work
            summaries and MongoDB search — voice is optional.
          </p>
        </div>
        <ButtonLink to="/worker/dashboard" variant="secondary">
          Back to dashboard
        </ButtonLink>
      </header>

      <form className="card form-grid" onSubmit={(event) => void onSubmit(event)} noValidate>
        <Field label="Machine" htmlFor="worklog-machine" error={errors.machineId}>
          <select
            id="worklog-machine"
            value={machineId}
            onChange={(event) => {
              setMachineId(event.target.value);
              demoStore.selectMachine(event.target.value);
            }}
          >
            <option value="">Select a machine</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.machineCode} — {machine.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Work date" htmlFor="worklog-date" error={errors.workDate}>
          <TextInput
            id="worklog-date"
            type="date"
            value={workDate}
            onChange={(event) => setWorkDate(event.target.value)}
          />
        </Field>
        <Field label="Title" htmlFor="worklog-title" error={errors.title}>
          <TextInput
            id="worklog-title"
            value={title}
            error={errors.title}
            placeholder="Evening run — press line checks"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="What did you do?" htmlFor="worklog-content" error={errors.content}>
          <textarea
            id="worklog-content"
            value={content}
            aria-invalid={errors.content ? true : undefined}
            placeholder="Describe the work completed, runtime, materials, stops, or handoff notes."
            onChange={(event) => setContent(event.target.value)}
          />
        </Field>
        <div className="row">
          <Button type="submit" loading={saving}>
            Save work log
          </Button>
          <Link className="btn btn-tertiary" to="/worker/dashboard">
            Cancel
          </Link>
        </div>
      </form>

      <section className="stack" aria-label="Your recent work logs">
        <h3>Your recent work logs</h3>
        {recentLogs.length === 0 ? (
          <p className="muted">No work logs from you yet.</p>
        ) : (
          <div className="stack">
            {recentLogs.map((memory) => {
              const machine = machines.find((item) => item.id === memory.machineId);
              return (
                <article key={memory.id} className="list-card">
                  <strong>{memory.title}</strong>
                  <p className="muted">
                    {machine
                      ? `${machine.machineCode} — ${machine.name}`
                      : "Machine"}{" "}
                    · {formatTimestamp(memory.createdAt, timezone)}
                  </p>
                  <p>{memory.summary ?? memory.content.slice(0, 160)}</p>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
