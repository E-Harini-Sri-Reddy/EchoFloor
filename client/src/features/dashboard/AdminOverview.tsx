import { Link } from "react-router-dom";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { constraintDisplayStatus, isConstraintActive } from "@/domain/constraints";
import { labelMemoryStatus, labelMachineStatus } from "@/domain/labels";
import {
  liveAlertsFor,
  constraintsForMachine,
  countOpenAlerts,
  handoversFor,
  latestMemoryForMachine,
  machinesFor,
  memoriesForMachine,
  unresolvedMemories,
  tasksFor,
  userById,
} from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { formatTimestamp } from "@/utils/format";

export function AdminOverviewPage() {
  const db = useDemoDatabase();
  const session = db.session;
  if (!session) return null;
  const organisation = db.organisations.find(
    (item) => item.id === session.organisationId,
  );
  const machines = machinesFor(db, session.organisationId);
  const memories = db.memories.filter(
    (memory) => memory.organisationId === session.organisationId,
  );
  const alerts = liveAlertsFor(db, session.organisationId);
  const now = new Date();
  const activeConstraints = db.constraints.filter(
    (constraint) =>
      constraint.organisationId === session.organisationId &&
      isConstraintActive(constraint, now),
  );
  const openIssues = unresolvedMemories(memories);
  const openTasks = tasksFor(db, session.organisationId, { status: "openish" });
  const timezone = organisation?.settings.timezone ?? "UTC";

  if (machines.length === 0) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <h2>Set up {organisation?.name}</h2>
            <p className="lede">
              No machines are registered. Counts stay empty until you add one.
            </p>
          </div>
        </header>
        <ol className="card stack">
          <li>Organisation {organisation?.name} is active. You are the administrator.</li>
          <li>Add the first machine from Machine Details. An NFC tag is optional.</li>
          <li>Invite workers from Settings. They receive worker access.</li>
        </ol>
        <ButtonLink to="/admin/machines">Go to Machine Details</ButtonLink>
      </div>
    );
  }

  const recent = [...memories]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Good day, {session.displayName.split(" ")[0]}</h2>
          <p className="lede">
            {organisation?.name}. Figures below are counted from example records in this
            browser session. They are not live plant metrics.
          </p>
        </div>
        <div className="row">
          <ButtonLink to="/admin/report-issue">Report issue</ButtonLink>
          <ButtonLink to="/admin/tasks" variant="secondary">
            Assign tasks
          </ButtonLink>
          <ButtonLink to="/admin/voice" variant="secondary">
            Open Voice Assistant
          </ButtonLink>
        </div>
      </header>
      <section className="metric-grid" aria-label="Summary">
        <article className="metric">
          <span>Registered machines</span>
          <strong>{machines.length}</strong>
        </article>
        <article className="metric">
          <span>Open tasks</span>
          <strong>{openTasks.length}</strong>
        </article>
        <article className="metric">
          <span>Unacknowledged alerts</span>
          <strong>{countOpenAlerts(alerts)}</strong>
        </article>
        <article className="metric">
          <span>Reports still open</span>
          <strong>{openIssues.length}</strong>
        </article>
        <article className="metric">
          <span>Active constraints</span>
          <strong>{activeConstraints.length}</strong>
        </article>
      </section>
      <div className="split">
        <section className="stack">
          <h3>Machines</h3>
          {machines.map((machine) => {
            const latest = latestMemoryForMachine(memories, machine.id);
            const machineConstraints = constraintsForMachine(
              db,
              session.organisationId,
              machine.id,
            );
            const active = machineConstraints.filter((constraint) =>
              isConstraintActive(constraint, now),
            );
            return (
              <Link
                key={machine.id}
                className="list-card"
                to={`/admin/machines/${machine.id}`}
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
                  {machine.location.area ? ` · ${machine.location.area}` : ""}
                </span>
                <span className="muted">
                  {latest
                    ? `Latest record: ${latest.title} · ${labelMemoryStatus(latest.status)}`
                    : "No operational records yet"}
                </span>
                <span className="muted">
                  {active.length > 0
                    ? `${active.length} active constraint${active.length === 1 ? "" : "s"}`
                    : "No active constraint"}
                  {" · "}
                  {
                    unresolvedMemories(
                      memoriesForMachine(db, session.organisationId, machine.id),
                    ).length
                  }{" "}
                  open reports
                </span>
              </Link>
            );
          })}
        </section>
        <section className="stack">
          <h3>Needs attention</h3>
          {openIssues.length === 0 && activeConstraints.length === 0 ? (
            <EmptyState
              title="Nothing is waiting"
              message="No unresolved reports or active constraints are in this session."
            />
          ) : (
            <ul className="timeline">
              {openIssues.slice(0, 4).map((memory) => (
                <li key={memory.id}>
                  <Link to={`/admin/memories/${memory.id}`}>{memory.title}</Link>
                  <div className="muted">{labelMemoryStatus(memory.status)}</div>
                </li>
              ))}
              {activeConstraints.map((constraint) => (
                <li key={constraint.id}>
                  <strong>{constraint.title}</strong>
                  <div className="muted">
                    {constraintDisplayStatus(constraint, now)} · expires{" "}
                    {constraint.expiresAt
                      ? formatTimestamp(constraint.expiresAt, timezone)
                      : "no expiry"}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h3>Recent records</h3>
          <ul className="timeline">
            {recent.map((memory) => {
              const machine = machines.find((item) => item.id === memory.machineId);
              const author = userById(db, memory.createdBy);
              return (
                <li key={memory.id} className="card">
                  <div className="spread">
                    <strong>{memory.title}</strong>
                    <StatusBadge
                      status={memory.status}
                      label={labelMemoryStatus(memory.status)}
                    />
                  </div>
                  <span className="muted">
                    {machine?.machineCode} · {formatTimestamp(memory.createdAt, timezone)}{" "}
                    · {author?.displayName ?? "Unknown"}
                  </span>
                </li>
              );
            })}
          </ul>
          <Link to="/admin/handover">
            Review shift handover ({handoversFor(db, session.organisationId).length})
          </Link>
        </section>
      </div>
    </div>
  );
}
