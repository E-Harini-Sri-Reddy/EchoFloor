import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { constraintDisplayStatus, isConstraintActive } from "@/domain/constraints";
import { labelHandoverStatus, labelMemoryStatus } from "@/domain/labels";
import {
  activeWorkerRows,
  assignmentsForShift,
  assignmentsForUser,
  handoversFor,
  machineById,
  machinesFor,
  memoryById,
  userById,
} from "@/domain/queries";
import {
  ensureShiftKind,
  labelShiftKind,
  labelShiftRotation,
  shiftPolicyOf,
  shiftsForOrganisation,
  timingChangeAllowed,
} from "@/domain/shifts";
import { SimpleMarkdown } from "@/components/markdown/SimpleMarkdown";
import { useDemoDatabase } from "@/hooks/useDemo";
import { useSpeech } from "@/hooks/useSpeech";
import { demoStore } from "@/services/demoStore";
import { pollHandoverRequest, postShiftHandover } from "@/services/n8nApi";
import type { ShiftKind, ShiftRotation, ShiftTemplate } from "@/types/domain";
import {
  delay,
  formatTimeRange,
  formatTimestamp,
  shiftWindowLabel,
} from "@/utils/format";

export function HandoverPage() {
  const [section, setSection] = useState<"schedule" | "handover">("schedule");
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Shifts and handover</h2>
          <p className="lede">
            Configure Morning, Afternoon, and Night shifts, assign workers with a
            mandatory rest window, then publish handover summaries.
          </p>
        </div>
      </header>
      <div className="tabs" role="tablist">
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={section === "schedule"}
          onClick={() => setSection("schedule")}
        >
          Shift schedule
        </button>
        <button
          type="button"
          className="tab"
          role="tab"
          aria-selected={section === "handover"}
          onClick={() => setSection("handover")}
        >
          Handover summary
        </button>
      </div>
      {section === "schedule" ? <ShiftSchedulePanel /> : <HandoverSummaryPanel />}
    </div>
  );
}

function ShiftSchedulePanel() {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const now = useMemo(() => new Date("2026-10-10T12:54:00.000Z"), []);
  const organisation = session
    ? db.organisations.find((item) => item.id === session.organisationId)
    : undefined;
  const policy = shiftPolicyOf(organisation);
  const timezone = organisation?.settings.timezone ?? "UTC";
  const shifts = session
    ? shiftsForOrganisation(db, session.organisationId)
    : [];
  const workers = session ? activeWorkerRows(db, session.organisationId) : [];
  const machines = session ? machinesFor(db, session.organisationId) : [];
  const timingGate = timingChangeAllowed(policy, now);

  const [templates, setTemplates] = useState<ShiftTemplate[]>(policy.templates);
  const [rotation, setRotation] = useState<ShiftRotation>(policy.rotation);
  const [minRestHours, setMinRestHours] = useState(
    String(policy.minRestHoursBetweenShifts),
  );
  const [policyErrors, setPolicyErrors] = useState<Record<string, string>>({});
  const [savingPolicy, setSavingPolicy] = useState(false);

  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? "");
  const [userId, setUserId] = useState(workers[0]?.membership.userId ?? "");
  const [machineIds, setMachineIds] = useState<string[]>([]);
  const [assignError, setAssignError] = useState("");
  const [assigning, setAssigning] = useState(false);

  if (!session) return null;

  function updateTemplate(
    kind: ShiftKind,
    patch: Partial<Pick<ShiftTemplate, "startLocal" | "durationMinutes">>,
  ) {
    setTemplates((current) =>
      current.map((template) =>
        template.kind === kind ? { ...template, ...patch } : template,
      ),
    );
  }

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    setSavingPolicy(true);
    await delay(250);
    const result = demoStore.updateShiftPolicy({
      templates,
      rotation,
      minRestHoursBetweenShifts: Number(minRestHours),
    });
    setSavingPolicy(false);
    if (!result.ok) {
      setPolicyErrors(result.fieldErrors ?? {});
      toast.push(result.message);
      return;
    }
    setPolicyErrors({});
    toast.push("Shift schedule saved in this browser session.");
  }

  async function assignWorker(event: FormEvent) {
    event.preventDefault();
    setAssigning(true);
    setAssignError("");
    await delay(250);
    const result = demoStore.assignWorkerToShift({
      shiftId,
      userId,
      machineIds,
    });
    setAssigning(false);
    if (!result.ok) {
      setAssignError(result.fieldErrors?.userId ?? result.message);
      toast.push(result.message);
      return;
    }
    toast.push("Worker assigned to the shift in this browser session.");
  }

  return (
    <div className="stack">
      <div className="notice">
        Organisation uses {labelShiftRotation(policy.rotation)} rotation. Workers need at
        least {policy.minRestHoursBetweenShifts} hours of rest between the end of one
        assigned shift and the start of the next. Shift timings cannot be changed more
        often than every {policy.timingChangeCooldownDays} days.
      </div>

      <form className="card form-grid" onSubmit={savePolicy} noValidate>
        <h3>Shift lengths and rotation</h3>
        {!timingGate.allowed ? (
          <div className="notice notice-warning" role="status">
            {timingGate.message} You can still assign workers. Rotation and rest-window
            settings can be updated without changing clock times.
          </div>
        ) : null}
        <Field label="Rotation period" htmlFor="shift-rotation" error={policyErrors.rotation}>
          <select
            id="shift-rotation"
            value={rotation}
            onChange={(event) => setRotation(event.target.value as ShiftRotation)}
          >
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly (every 14 days)</option>
          </select>
        </Field>
        <Field
          label="Mandatory rest between shifts (hours)"
          htmlFor="shift-rest"
          error={policyErrors.minRestHoursBetweenShifts}
        >
          <TextInput
            id="shift-rest"
            type="number"
            min={1}
            max={24}
            value={minRestHours}
            error={policyErrors.minRestHoursBetweenShifts}
            onChange={(event) => setMinRestHours(event.target.value)}
          />
        </Field>
        {templates.map((template) => (
          <div key={template.kind} className="card stack">
            <strong>{labelShiftKind(template.kind)}</strong>
            <div className="filter-bar">
              <Field
                label="Starts (local)"
                htmlFor={`start-${template.kind}`}
                error={policyErrors[`start_${template.kind}`]}
              >
                <TextInput
                  id={`start-${template.kind}`}
                  type="time"
                  value={template.startLocal}
                  disabled={!timingGate.allowed}
                  error={policyErrors[`start_${template.kind}`]}
                  onChange={(event) =>
                    updateTemplate(template.kind, { startLocal: event.target.value })
                  }
                />
              </Field>
              <Field
                label="Length (minutes)"
                htmlFor={`duration-${template.kind}`}
                error={policyErrors[`duration_${template.kind}`]}
              >
                <TextInput
                  id={`duration-${template.kind}`}
                  type="number"
                  min={60}
                  max={720}
                  step={30}
                  value={String(template.durationMinutes)}
                  disabled={!timingGate.allowed}
                  error={policyErrors[`duration_${template.kind}`]}
                  onChange={(event) =>
                    updateTemplate(template.kind, {
                      durationMinutes: Number(event.target.value),
                    })
                  }
                />
              </Field>
            </div>
          </div>
        ))}
        <Button type="submit" loading={savingPolicy}>
          Save schedule settings
        </Button>
        {policy.lastTimingChangedAt ? (
          <p className="muted">
            Last timing change: {formatTimestamp(policy.lastTimingChangedAt, timezone)}
          </p>
        ) : (
          <p className="muted">Shift timings have not been changed yet in this session.</p>
        )}
      </form>

      <form className="card form-grid" onSubmit={assignWorker} noValidate>
        <h3>Assign a worker to a shift</h3>
        <p className="muted">
          Back-to-back consecutive shifts are blocked when they leave less than the
          mandatory rest window.
        </p>
        <Field label="Shift" htmlFor="assign-shift">
          <select
            id="assign-shift"
            value={shiftId}
            onChange={(event) => setShiftId(event.target.value)}
          >
            {shifts.map((shift) => (
              <option key={shift.id} value={shift.id}>
                {labelShiftKind(ensureShiftKind(shift))} ·{" "}
                {formatTimeRange(shift.startAt, shift.endAt, timezone)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Worker" htmlFor="assign-worker" error={assignError}>
          <select
            id="assign-worker"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
          >
            {workers.map(({ membership, user }) => (
              <option key={membership.id} value={membership.userId}>
                {user?.displayName}
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="stack">
          <legend>Machines on this assignment</legend>
          {machines.map((machine) => (
            <label key={machine.id} className="check">
              <input
                type="checkbox"
                checked={machineIds.includes(machine.id)}
                onChange={(event) => {
                  setMachineIds((current) =>
                    event.target.checked
                      ? [...current, machine.id]
                      : current.filter((id) => id !== machine.id),
                  );
                }}
              />
              <span className="mono">{machine.machineCode}</span> — {machine.name}
            </label>
          ))}
        </fieldset>
        <Button type="submit" loading={assigning} disabled={shifts.length === 0}>
          Assign worker
        </Button>
      </form>

      <section className="stack">
        <h3>Current roster</h3>
        {shifts.length === 0 ? (
          <EmptyState
            title="No shifts scheduled"
            message="Morning, Afternoon, and Night instances for the demo day appear here."
          />
        ) : (
          shifts.map((shift) => {
            const assigned = assignmentsForShift(db, session.organisationId, shift.id);
            return (
              <article key={shift.id} className="card stack">
                <div className="spread">
                  <strong>
                    {labelShiftKind(ensureShiftKind(shift))}{" "}
                    <span className="muted">
                      · {formatTimeRange(shift.startAt, shift.endAt, timezone)}
                    </span>
                  </strong>
                  <StatusBadge
                    status="info"
                    label={shiftWindowLabel(shift.startAt, shift.endAt, now)}
                  />
                </div>
                {assigned.length === 0 ? (
                  <p className="muted">No workers assigned.</p>
                ) : (
                  assigned.map((assignment) => {
                    const worker = userById(db, assignment.userId);
                    return (
                      <div key={assignment.id} className="list-card stack">
                        <div className="spread">
                          <strong>{worker?.displayName ?? "Unknown worker"}</strong>
                          <Button
                            variant="tertiary"
                            onClick={() => {
                              const result = demoStore.removeShiftAssignment(
                                assignment.id,
                              );
                              toast.push(
                                result.ok
                                  ? "Assignment removed in this browser session."
                                  : result.message,
                              );
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                        <span className="muted">
                          {assignment.machineIds.length
                            ? assignment.machineIds
                                .map((machineId) => {
                                  const machine = machineById(
                                    db,
                                    session.organisationId,
                                    machineId,
                                  );
                                  return machine?.machineCode;
                                })
                                .filter(Boolean)
                                .join(", ")
                            : "No machines listed"}
                        </span>
                      </div>
                    );
                  })
                )}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

function HandoverSummaryPanel() {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const speech = useSpeech();
  const [pending, setPending] = useState<"generate" | "publish" | null>(null);
  const [error, setError] = useState("");
  const [liveMarkdown, setLiveMarkdown] = useState<string | null>(null);
  const [liveMemoryIds, setLiveMemoryIds] = useState<string[]>([]);
  if (!session) return null;
  const activeSession = session;
  const handovers = handoversFor(db, activeSession.organisationId);
  const current = handovers[0];
  const shifts = shiftsForOrganisation(db, activeSession.organisationId);
  const timezone =
    db.organisations.find((item) => item.id === activeSession.organisationId)?.settings
      .timezone ?? "UTC";
  const now = new Date();

  async function generate() {
    setPending("generate");
    setError("");
    setLiveMarkdown(null);
    setLiveMemoryIds([]);
    if (activeSession.live) {
      const shiftId = shifts[0]?.id;
      if (!shiftId) {
        setPending(null);
        setError("Schedule at least one shift before generating a handover.");
        return;
      }
      const started = await postShiftHandover(
        { userId: activeSession.userId, organisationId: activeSession.organisationId },
        shiftId,
      );
      if (!started.ok) {
        setPending(null);
        setError(started.message);
        return;
      }
      const polled = await pollHandoverRequest(
        { userId: activeSession.userId, organisationId: activeSession.organisationId },
        started.requestId,
      );
      setPending(null);
      if (!polled.ok) {
        setError(polled.message);
        return;
      }
      if (polled.data.status === "failed") {
        setError(polled.data.errorMessage ?? "Handover workflow failed.");
        return;
      }
      const markdown =
        polled.data.handover?.summaryMarkdown ??
        String(
          (polled.data.result as { summaryMarkdown?: string } | null)?.summaryMarkdown ?? "",
        );
      if (!markdown.trim()) {
        setError("Handover completed but no summary text was returned.");
        return;
      }
      setLiveMarkdown(markdown);
      setLiveMemoryIds(polled.data.handover?.memoryIds ?? []);
      toast.push("Handover summary returned from n8n.");
      return;
    }
    await delay(500);
    const result = demoStore.generateHandover();
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.push("Draft handover assembled in this browser session. No AI model was used.");
  }

  async function publish(id: string) {
    setPending("publish");
    await delay(300);
    const result = demoStore.publishHandover(id);
    setPending(null);
    toast.push(
      result.ok ? "Handover published in this browser session." : result.message,
    );
  }

  return (
    <div className="stack">
      <div className="spread">
        <p className="lede" style={{ margin: 0 }}>
          Generated summaries are labeled separately from the operator reports they cite.
        </p>
        <Button onClick={() => void generate()} loading={pending === "generate"}>
          Generate handover
        </Button>
      </div>
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}
      {activeSession.live && liveMarkdown ? (
        <article className="card stack">
          <div className="spread">
            <h3>Generated handover (live)</h3>
            <Button variant="tertiary" onClick={() => void speech.speakAsync(liveMarkdown)}>
              Read aloud
            </Button>
          </div>
          <p className="notice notice-info">
            Rendered from markdown returned by n8n. HTML tags are stripped before display.
          </p>
          <SimpleMarkdown source={liveMarkdown} />
          {liveMemoryIds.length ? (
            <>
              <h3>Cited memory ids</h3>
              <ul>
                {liveMemoryIds.map((memoryId) => (
                  <li key={memoryId}>
                    <Link to={`/admin/memories/${memoryId}`}>{memoryId}</Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </article>
      ) : null}
      {!current && !(activeSession.live && liveMarkdown) ? (
        <EmptyState
          title="No handover available"
          message="Generate a draft after operational records exist. An empty organisation will not invent shift activity."
        />
      ) : current && (!activeSession.live || !liveMarkdown) ? (
        <article className="card stack">
          <div className="spread">
            <h3>{current.title}</h3>
            <StatusBadge
              status={current.status}
              label={labelHandoverStatus(current.status)}
            />
          </div>
          <p className="notice notice-info">
            {current.summaryKind === "generated"
              ? "Generated summary. Acknowledgement does not verify the operational facts."
              : "Operator-authored handover."}
          </p>
          <p>{current.summary}</p>
          <p className="muted">Updated {formatTimestamp(current.updatedAt, timezone)}</p>
          {current.status === "draft" ? (
            <Button
              variant="secondary"
              onClick={() => void publish(current.id)}
              loading={pending === "publish"}
            >
              Publish draft
            </Button>
          ) : null}
          <h3>Cited reports</h3>
          {current.memoryIds.length === 0 ? (
            <p className="muted">No source reports.</p>
          ) : null}
          <ul className="timeline">
            {current.memoryIds.map((memoryId) => {
              const memory = memoryById(db, session.organisationId, memoryId);
              if (!memory) return null;
              const machine = machineById(db, session.organisationId, memory.machineId);
              return (
                <li key={memoryId}>
                  <Link to={`/admin/memories/${memory.id}`}>
                    {machine?.machineCode}: {memory.title}
                  </Link>
                  <div className="muted">
                    Operator record · {labelMemoryStatus(memory.status)} · “
                    {memory.content.slice(0, 140)}”
                  </div>
                </li>
              );
            })}
          </ul>
          <h3>Constraints</h3>
          {current.constraintIds.map((constraintId) => {
            const constraint = db.constraints.find(
              (item) =>
                item.id === constraintId &&
                item.organisationId === session.organisationId,
            );
            if (!constraint) return null;
            return (
              <p key={constraint.id}>
                {constraint.title} — {constraintDisplayStatus(constraint, now)}
                {isConstraintActive(constraint, now) ? "" : ". Not current guidance."}
              </p>
            );
          })}
        </article>
      ) : null}
    </div>
  );
}

export function MyShiftPage() {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const [pending, setPending] = useState(false);
  if (!session) return null;
  const organisation = db.organisations.find(
    (item) => item.id === session.organisationId,
  );
  const timezone = organisation?.settings.timezone ?? "UTC";
  const policy = shiftPolicyOf(organisation);
  const assignments = assignmentsForUser(db, session.organisationId, session.userId);
  const shift = assignments
    .map((assignment) => db.shifts.find((item) => item.id === assignment.shiftId))
    .find((item) => item !== undefined);
  const handover = db.handovers.find(
    (item) =>
      item.organisationId === session.organisationId &&
      (item.status === "published" || item.status === "acknowledged"),
  );

  async function acknowledge() {
    if (!handover) return;
    setPending(true);
    await delay(300);
    const result = demoStore.acknowledgeHandover(handover.id);
    setPending(false);
    if (result.ok) {
      toast.push(
        "Handover acknowledged. It left the notification badge. This does not verify the records.",
        { to: "/worker/shift" },
      );
    } else {
      toast.push(result.message);
    }
  }

  if (!shift) {
    return (
      <div className="page">
        <EmptyState
          title="No shift is assigned"
          message="Nothing in this session assigns you to a shift. EchoFloor is not inferring that you are clocked in."
        />
      </div>
    );
  }

  const assignment = assignments.find((item) => item.shiftId === shift.id);

  async function acceptAssignment() {
    if (!assignment) return;
    setPending(true);
    await delay(300);
    const result = demoStore.acceptShiftAssignment(assignment.id);
    setPending(false);
    if (result.ok) {
      toast.push("Assignment acknowledged. It left the notification badge.", {
        to: "/worker/shift",
      });
    } else {
      toast.push(result.message);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>{labelShiftKind(ensureShiftKind(shift))} shift</h2>
          <p className="lede">
            {formatTimeRange(shift.startAt, shift.endAt, timezone)} ·{" "}
            {shiftWindowLabel(shift.startAt, shift.endAt)} ·{" "}
            {labelShiftRotation(policy.rotation)} rotation
          </p>
        </div>
        <div className="row">
          <StatusBadge status="info" label={assignment?.status ?? "assigned"} />
          {assignment?.status === "assigned" ? (
            <Button onClick={() => void acceptAssignment()} loading={pending}>
              Acknowledge assignment
            </Button>
          ) : null}
        </div>
      </header>
      <section className="card stack">
        <h3>Assigned machines</h3>
        {assignment?.machineIds.length ? (
          assignment.machineIds.map((machineId) => {
            const machine = machineById(db, session.organisationId, machineId);
            if (!machine) return null;
            return (
              <Link key={machineId} to={`/worker/machines/${machine.id}`}>
                {machine.machineCode} — {machine.name}
              </Link>
            );
          })
        ) : (
          <p className="muted">No machines are listed on this assignment.</p>
        )}
      </section>
      <section className="card stack">
        <h3>Handover notes</h3>
        {handover ? (
          <>
            <p className="notice notice-info">
              Generated summary, kept separate from the quoted reports inside it.
            </p>
            <p>{handover.summary}</p>
            <StatusBadge
              status={handover.status}
              label={labelHandoverStatus(handover.status)}
            />
            {handover.status === "published" ? (
              <Button onClick={() => void acknowledge()} loading={pending}>
                Acknowledge handover
              </Button>
            ) : (
              <p className="muted">
                Acknowledged{" "}
                {handover.acknowledgedAt
                  ? formatTimestamp(handover.acknowledgedAt, timezone)
                  : ""}
                . This does not mark the underlying reports as verified.
              </p>
            )}
          </>
        ) : (
          <EmptyState
            title="No handover for this shift"
            message="An administrator has not published one in this session."
          />
        )}
      </section>
    </div>
  );
}
