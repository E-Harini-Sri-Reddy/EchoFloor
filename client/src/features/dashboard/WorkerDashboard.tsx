import { Link } from "react-router-dom";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  labelAlertStatus,
  labelMachineStatus,
  labelMemoryStatus,
  labelSeverity,
} from "@/domain/labels";
import {
  liveAlertsFor,
  assignmentsForUser,
  handoversFor,
  latestMemoryForMachine,
  machinesFor,
  tasksFor,
} from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { formatTimeRange, shiftWindowLabel } from "@/utils/format";

export function WorkerDashboardPage() {
  const db = useDemoDatabase();
  const session = db.session;
  if (!session) return null;
  const organisation = db.organisations.find(
    (item) => item.id === session.organisationId,
  );
  const timezone = organisation?.settings.timezone ?? "UTC";
  const assignments = assignmentsForUser(db, session.organisationId, session.userId);
  const shifts = assignments
    .map((assignment) => db.shifts.find((shift) => shift.id === assignment.shiftId))
    .filter((shift) => shift !== undefined);
  const current = shifts[0];
  const machines = machinesFor(db, session.organisationId).filter((machine) => {
    if (assignments.length === 0) return machine.status !== "inactive";
    return assignments.some((assignment) => assignment.machineIds.includes(machine.id));
  });
  const memories = db.memories.filter(
    (memory) => memory.organisationId === session.organisationId,
  );
  const alerts = liveAlertsFor(db, session.organisationId, {
    audienceUserId: session.userId,
  });
  const handover = handoversFor(db, session.organisationId).find(
    (item) => item.status === "published" || item.status === "acknowledged",
  );
  const openTasks = tasksFor(db, session.organisationId, {
    assigneeUserId: session.userId,
    status: "openish",
  });

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>{session.displayName.split(" ")[0]}, here is your shift</h2>
          <p className="lede">
            {current
              ? `${current.name}: ${formatTimeRange(current.startAt, current.endAt, timezone)} · ${shiftWindowLabel(current.startAt, current.endAt)}`
              : "No shift is assigned."}{" "}
            This is not a clock-in record.
          </p>
        </div>
        <ButtonLink to="/worker/voice">Ask or report</ButtonLink>
      </header>
      <div className="card-grid">
        <Link className="list-card" to="/worker/tasks">
          <strong>My tasks</strong>
          <span className="muted">
            {openTasks.length} open
            {openTasks[0] ? ` · next: ${openTasks[0].title}` : ""}.
          </span>
        </Link>
        <Link className="list-card" to="/worker/voice">
          <strong>Voice Assistant</strong>
          <span className="muted">Ask about a machine or submit a new report.</span>
        </Link>
        <Link className="list-card" to="/worker/machines">
          <strong>Machines</strong>
          <span className="muted">{machines.length} in your current view.</span>
        </Link>
        <Link className="list-card" to="/worker/alerts">
          <strong>Alerts</strong>
          <span className="muted">{alerts.length} open application notices.</span>
        </Link>
        <Link className="list-card" to="/worker/shift">
          <strong>My Shift</strong>
          <span className="muted">Handover notes and follow-ups.</span>
        </Link>
      </div>
      <section className="stack">
        <h3>Machines for this view</h3>
        {machines.length === 0 ? (
          <EmptyState
            title="No machines in view"
            message="An administrator has not assigned machines, and none are active in this organisation."
          />
        ) : (
          machines.map((machine) => {
            const latest = latestMemoryForMachine(memories, machine.id);
            return (
              <Link
                key={machine.id}
                className="list-card"
                to={`/worker/machines/${machine.id}`}
              >
                <div className="spread">
                  <strong className="mono">{machine.machineCode}</strong>
                  <StatusBadge
                    status={machine.status}
                    label={labelMachineStatus(machine.status)}
                  />
                </div>
                <span>{machine.name}</span>
                <span className="muted">
                  {machine.location.productionLine ?? "Line not set"}
                </span>
                <span className="muted">
                  {latest
                    ? `${latest.title} · ${labelMemoryStatus(latest.status)}`
                    : "No records yet"}
                </span>
              </Link>
            );
          })
        )}
      </section>
      <section className="stack">
        <h3>Open alerts</h3>
        {alerts.length === 0 ? (
          <EmptyState
            title="No open alerts"
            message="There are no open application notices for this organisation in the session."
          />
        ) : (
          alerts.slice(0, 3).map((alert) => (
            <Link key={alert.id} className="list-card" to={`/worker/alerts/${alert.id}`}>
              <div className="spread">
                <strong>{alert.title}</strong>
                <StatusBadge
                  status={alert.severity}
                  label={labelSeverity(alert.severity)}
                />
              </div>
              <span className="muted">{labelAlertStatus(alert.status)}</span>
            </Link>
          ))
        )}
      </section>
      <section className="card stack">
        <h3>Handover</h3>
        {handover ? (
          <>
            <p className="notice notice-info">
              Generated summary, not an operator's original words.
            </p>
            <p>{handover.summary}</p>
            <Link to="/worker/shift">Open My Shift</Link>
          </>
        ) : (
          <EmptyState
            title="No handover is available"
            message="Nothing has been published for this organisation in the current session."
          />
        )}
      </section>
    </div>
  );
}
