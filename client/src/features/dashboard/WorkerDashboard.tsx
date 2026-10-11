import { useState } from "react";
import { Link } from "react-router-dom";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { isTemporaryWorker } from "@/domain/access";
import { summarizeTaskDescription } from "@/domain/assistant";
import {
  labelAlertStatus,
  labelSeverity,
  labelTaskPriority,
  labelTaskStatus,
} from "@/domain/labels";
import {
  assignmentsForUser,
  handoversFor,
  liveAlertsFor,
  machineById,
  tasksFor,
} from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { formatTimeRange, formatTimestamp, shiftWindowLabel } from "@/utils/format";

type WorkSummaryPeriod = "daily" | "weekly" | "monthly" | "yearly";

const PERIODS: { id: WorkSummaryPeriod; label: string; title: string }[] = [
  { id: "daily", label: "Daily", title: "Daily Work Summary" },
  { id: "weekly", label: "Weekly", title: "Weekly Work Summary" },
  { id: "monthly", label: "Monthly", title: "Monthly Work Summary" },
  { id: "yearly", label: "Yearly", title: "Yearly Work Summary" },
];

export function WorkerDashboardPage() {
  const db = useDemoDatabase();
  const session = db.session;
  const [period, setPeriod] = useState<WorkSummaryPeriod>("daily");
  if (!session) return null;
  const organisation = db.organisations.find(
    (item) => item.id === session.organisationId,
  );
  const timezone = organisation?.settings.timezone ?? "UTC";
  const selected = PERIODS.find((item) => item.id === period) ?? PERIODS[0];
  const assignments = assignmentsForUser(db, session.organisationId, session.userId);
  const shifts = assignments
    .map((assignment) => db.shifts.find((shift) => shift.id === assignment.shiftId))
    .filter((shift) => shift !== undefined);
  const current = shifts[0];
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
  const temporary = isTemporaryWorker(session);

  return (
    <div className="page worker-dashboard">
      <header className="page-header">
        <div>
          <h2>{session.displayName.split(" ")[0]}, your work</h2>
          <p className="lede">
            {current
              ? `${current.name}: ${formatTimeRange(current.startAt, current.endAt, timezone)} · ${shiftWindowLabel(current.startAt, current.endAt)}`
              : "No shift is assigned right now."}{" "}
            Summaries below cover your work only.
          </p>
        </div>
        <div className="row">
          <ButtonLink to="/worker/work-log">Log today’s work</ButtonLink>
          <ButtonLink to="/worker/issues/report" variant="secondary">
            Report issue
          </ButtonLink>
          <ButtonLink to="/worker/tasks" variant="secondary">
            My tasks ({openTasks.length})
          </ButtonLink>
        </div>
      </header>

      <section className="stack" aria-label="Work summary">
        <h3>Work summary</h3>
        <div className="tabs" role="tablist" aria-label="Summary period">
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={period === item.id}
              onClick={() => setPeriod(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <article className="card stack" role="tabpanel" aria-label={selected.title}>
          <h3>{selected.title}</h3>
          <p className="muted">
            AI summary of your work for this period is pending. It will appear here once
            the integration is connected.
          </p>
        </article>
      </section>

      <section className="stack" aria-label="Tasks assigned">
        <div className="spread">
          <h3>Tasks assigned</h3>
          {openTasks.length > 0 ? <Link to="/worker/tasks">View all</Link> : null}
        </div>
        {openTasks.length === 0 ? (
          <EmptyState
            title="No open tasks"
            message="Nothing is assigned to you right now."
          />
        ) : (
          <div className="stack">
            {openTasks.slice(0, 5).map((task) => {
              const machine = task.machineId
                ? machineById(db, session.organisationId, task.machineId)
                : null;
              const aiBrief = summarizeTaskDescription(task.description);
              return (
                <Link
                  key={task.id}
                  className="list-card stack"
                  to={`/worker/tasks?task=${encodeURIComponent(task.id)}`}
                >
                  <div className="spread">
                    <strong>{task.title}</strong>
                    <div className="row">
                      <StatusBadge
                        status={task.priority}
                        label={labelTaskPriority(task.priority)}
                      />
                      <StatusBadge
                        status={task.status}
                        label={labelTaskStatus(task.status)}
                      />
                    </div>
                  </div>
                  {aiBrief ? (
                    <p className="muted">
                      <span className="card-kicker">AI summary · </span>
                      {aiBrief}
                    </p>
                  ) : null}
                  <span className="muted">
                    {machine ? (
                      <>
                        <span className="mono">{machine.machineCode}</span>
                        {task.dueAt ? " · " : ""}
                      </>
                    ) : null}
                    {task.dueAt ? `Due ${formatTimestamp(task.dueAt, timezone)}` : null}
                    {!machine && !task.dueAt ? "Open task" : null}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <div className="dashboard-pair">
        <section className="card stack dashboard-pair-panel">
          <div className="spread">
            <h3>Alerts</h3>
            {alerts.length > 0 ? (
              <Link to="/worker/issues/alerts">View all</Link>
            ) : null}
          </div>
          {alerts.length === 0 ? (
            <EmptyState
              title="No open alerts"
              message="Nothing needs your attention right now."
            />
          ) : (
            alerts.slice(0, 4).map((alert) => (
              <Link
                key={alert.id}
                className="list-card"
                to={`/worker/alerts/${alert.id}`}
              >
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

        <section className="card stack dashboard-pair-panel">
          <h3>Shift handover</h3>
          {handover ? (
            <>
              <p className="notice notice-info">
                Generated summary, not an operator&apos;s original words.
              </p>
              <p>{handover.summary}</p>
              {temporary ? null : (
                <Link to="/worker/shift">Review shift handover</Link>
              )}
            </>
          ) : (
            <EmptyState
              title="No handover to review"
              message="Nothing has been published for your shift yet."
            />
          )}
        </section>
      </div>
    </div>
  );
}
