import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { labelMachineIssueKind } from "@/domain/alerts";
import { labelAlertStatus, labelAlertType, labelSeverity } from "@/domain/labels";
import {
  alertById,
  filterAlerts,
  liveAlertsFor,
  machineById,
  machinesFor,
} from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { demoStore } from "@/services/demoStore";
import { delay, formatTimestamp } from "@/utils/format";

export function AlertListPage({ role }: { role: "admin" | "worker" }) {
  const db = useDemoDatabase();
  const session = db.session;
  const now = useMemo(() => new Date(), []);
  const [bucket, setBucket] = useState<"all" | "critical" | "warning">("all");
  const [text, setText] = useState("");
  const [machineId, setMachineId] = useState("all");
  if (!session) return null;
  const base = role === "admin" ? "/admin" : "/worker";
  const alerts = filterAlerts(
    liveAlertsFor(db, session.organisationId, {
      now,
      audienceUserId: role === "worker" ? session.userId : undefined,
    }),
    { bucket, text, machineId: machineId as "all" },
  );
  const machines = machinesFor(db, session.organisationId);
  const timezone =
    db.organisations.find((item) => item.id === session.organisationId)?.settings
      .timezone ?? "UTC";

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Live alerts</h2>
          <p className="lede">
            Active damage, breakdown, maintenance holds, and hazard warnings. Informational
            notices stay on machine information. Alerts leave this list when their window
            ends.
          </p>
        </div>
        <ButtonLink to={`${base}/alerts/report`}>Report an issue</ButtonLink>
      </header>
      <div className="tabs" role="tablist" aria-label="Alert filters">
        {(
          [
            ["all", "All active"],
            ["critical", "Critical"],
            ["warning", "Warning"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="tab"
            role="tab"
            aria-selected={bucket === value}
            onClick={() => setBucket(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="filter-bar">
        <Field label="Search alerts" htmlFor="alert-search">
          <TextInput
            id="alert-search"
            value={text}
            placeholder="Machine or description"
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <Field label="Machine" htmlFor="alert-machine">
          <select
            id="alert-machine"
            value={machineId}
            onChange={(event) => setMachineId(event.target.value)}
          >
            <option value="all">All machines</option>
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.machineCode}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {alerts.length === 0 ? (
        <EmptyState
          title="No active alerts"
          message="Nothing damaged, under maintenance, or unsafe matches this filter. Expired windows are removed automatically."
          action={<ButtonLink to={`${base}/alerts/report`}>Report an issue</ButtonLink>}
        />
      ) : (
        <div className="stack">
          {alerts.map((alert) => {
            const machine = alert.machineId
              ? machineById(db, session.organisationId, alert.machineId)
              : null;
            return (
              <Link
                key={alert.id}
                className="list-card"
                to={`${base}/alerts/${alert.id}`}
              >
                <div className="spread">
                  <strong>{alert.title}</strong>
                  <StatusBadge
                    status={alert.severity}
                    label={labelSeverity(alert.severity)}
                  />
                </div>
                <span className="muted">
                  {labelAlertType(alert.type)}
                  {alert.issueKind ? ` · ${labelMachineIssueKind(alert.issueKind)}` : ""}
                  {" · "}
                  {machine ? machine.machineCode : "Organisation"}
                  {alert.expiresAt
                    ? ` · until ${formatTimestamp(alert.expiresAt, timezone)}`
                    : ""}
                </span>
                <span>{alert.message}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AlertDetailPage({ role }: { role: "admin" | "worker" }) {
  const { alertId = "" } = useParams();
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const now = useMemo(() => new Date(), []);
  const [pending, setPending] = useState<"ack" | "resolve" | null>(null);
  if (!session) return null;
  const alert = alertById(db, session.organisationId, alertId);
  const base = role === "admin" ? "/admin" : "/worker";
  if (!alert) {
    return (
      <div className="page">
        <EmptyState
          title="Alert not found"
          message="That notice is not in the active organisation."
        />
      </div>
    );
  }
  const machine = alert.machineId
    ? machineById(db, session.organisationId, alert.machineId)
    : null;
  const timezone =
    db.organisations.find((item) => item.id === session.organisationId)?.settings
      .timezone ?? "UTC";
  const expired = Boolean(
    alert.expiresAt && new Date(alert.expiresAt).getTime() <= now.getTime(),
  );

  async function acknowledge() {
    setPending("ack");
    await delay(300);
    const result = demoStore.acknowledgeAlert(alert!.id);
    setPending(null);
    toast.push(
      result.ok ? "Alert acknowledged in this browser session." : result.message,
    );
  }

  async function resolve() {
    setPending("resolve");
    await delay(300);
    const result = demoStore.resolveAlert(alert!.id);
    setPending(null);
    toast.push(
      result.ok ? "Alert marked resolved in this browser session." : result.message,
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="muted">
            <Link to={`${base}/alerts`}>Live alerts</Link>
          </p>
          <h2>{alert.title}</h2>
        </div>
        <div className="row">
          <StatusBadge status={alert.severity} label={labelSeverity(alert.severity)} />
          <StatusBadge
            status={expired ? "Expired" : alert.status === "open" ? "warning" : alert.status}
            label={expired ? "Window ended" : labelAlertStatus(alert.status)}
          />
        </div>
      </header>
      {expired ? (
        <div className="notice notice-warning" role="status">
          This alert window has ended. It no longer appears in the Live Alerts list.
        </div>
      ) : null}
      <article className="card stack">
        <p>{alert.message}</p>
        {alert.photoDataUrl ? (
          <figure className="issue-photo-preview">
            <img src={alert.photoDataUrl} alt={alert.photoName ?? "Issue photo"} />
            <figcaption className="muted">
              {alert.photoName ?? "Attached photo"} · stored in this browser session only
            </figcaption>
          </figure>
        ) : null}
        <p className="muted">
          {labelAlertType(alert.type)}
          {alert.issueKind ? ` · ${labelMachineIssueKind(alert.issueKind)}` : ""}
          {" · "}
          Reported {formatTimestamp(alert.createdAt, timezone)}
          {alert.expiresAt
            ? ` · active until ${formatTimestamp(alert.expiresAt, timezone)}`
            : ""}
        </p>
        {machine ? (
          role === "admin" || session.workerAccessType !== "temporary" ? (
            <Link to={`${base}/machines/${machine.id}`}>
              {machine.machineCode} — {machine.name}
            </Link>
          ) : (
            <p>
              <span className="mono">{machine.machineCode}</span> — {machine.name}
            </p>
          )
        ) : (
          <p className="muted">Not tied to one machine.</p>
        )}
        {role === "admin" && alert.sourceType === "memory" && alert.sourceId ? (
          <Link to={`/admin/memories/${alert.sourceId}`}>Open source memory</Link>
        ) : null}
      </article>
      <div className="row">
        <Button
          onClick={() => void acknowledge()}
          loading={pending === "ack"}
          disabled={alert.status !== "open" || expired}
        >
          Acknowledge
        </Button>
        {role === "admin" ? (
          <Button
            variant="secondary"
            onClick={() => void resolve()}
            loading={pending === "resolve"}
            disabled={alert.status === "resolved" || expired}
          >
            Mark resolved
          </Button>
        ) : null}
      </div>
    </div>
  );
}
