import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Field, TextInput } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { constraintDisplayStatus, isConstraintActive } from "@/domain/constraints";
import {
  labelMachineStatus,
  labelMemoryStatus,
  labelMemoryType,
  labelSeverity,
} from "@/domain/labels";
import {
  constraintsForMachine,
  liveAlertsFor,
  machineById,
  machineInfoNoticesFor,
  machinesFor,
  memoriesForMachine,
  unresolvedMemories,
  userById,
} from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { formatTimestamp } from "@/utils/format";
import { ButtonLink } from "@/components/ui/Button";

export function MachineListPage({ role }: { role: "admin" | "worker" }) {
  const db = useDemoDatabase();
  const session = db.session;
  const [text, setText] = useState("");
  const [line, setLine] = useState("all");
  if (!session) return null;
  const base = role === "admin" ? "/admin" : "/worker";
  const machines = machinesFor(db, session.organisationId).filter((machine) => {
    const haystack = `${machine.machineCode} ${machine.name}`.toLowerCase();
    const matchesText = haystack.includes(text.trim().toLowerCase());
    const matchesLine =
      line === "all" || (machine.location.productionLine ?? "") === line;
    return matchesText && matchesLine;
  });
  const lines = [
    ...new Set(
      machinesFor(db, session.organisationId)
        .map((machine) => machine.location.productionLine)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const memories = db.memories.filter(
    (memory) => memory.organisationId === session.organisationId,
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Machines</h2>
          <p className="lede">
            Search by identifier or name. Record status is not a live health reading.
          </p>
        </div>
      </header>
      <div className="filter-bar">
        <Field label="Search machines" htmlFor="machine-search">
          <TextInput
            id="machine-search"
            value={text}
            placeholder="M-104 or Press Line"
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <Field label="Production line" htmlFor="machine-line">
          <select
            id="machine-line"
            value={line}
            onChange={(event) => setLine(event.target.value)}
          >
            <option value="all">All lines</option>
            {lines.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {machines.length === 0 ? (
        <EmptyState
          title="No machines match"
          message={
            machinesFor(db, session.organisationId).length === 0
              ? "This organisation has no machines yet."
              : "Try a different identifier, name, or line."
          }
          action={
            role === "admin" ? (
              <ButtonLink to="/admin/settings">Add a machine in Settings</ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="card-grid">
          {machines.map((machine) => {
            const related = memories.filter((memory) => memory.machineId === machine.id);
            const latest = related[0];
            return (
              <Link
                key={machine.id}
                className="list-card"
                to={`${base}/machines/${machine.id}`}
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
                  NFC{" "}
                  {machine.nfc.enabled && machine.nfc.tagId
                    ? `linked (${machine.nfc.tagId})`
                    : "not configured"}
                </span>
                <span className="muted">
                  {latest ? latest.title : "No records"} ·{" "}
                  {unresolvedMemories(related).length} open reports
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MachineDetailPage({ role }: { role: "admin" | "worker" }) {
  const { machineId = "" } = useParams();
  const db = useDemoDatabase();
  const session = db.session;
  const now = useMemo(() => new Date(), []);
  if (!session) return null;
  const machine = machineById(db, session.organisationId, machineId);
  const base = role === "admin" ? "/admin" : "/worker";
  if (!machine) {
    return (
      <div className="page">
        <EmptyState
          title="Machine not found"
          message="That machine is not in the active organisation."
        />
      </div>
    );
  }
  const memories = memoriesForMachine(db, session.organisationId, machine.id);
  const constraints = constraintsForMachine(db, session.organisationId, machine.id);
  const liveAlerts = liveAlertsFor(db, session.organisationId, {
    machineId: machine.id,
    now,
  });
  const infoNotices = machineInfoNoticesFor(db, session.organisationId, machine.id, now);
  const timezone =
    db.organisations.find((item) => item.id === session.organisationId)?.settings
      .timezone ?? "UTC";

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="muted">
            <Link to={`${base}/machines`}>Machines</Link>
          </p>
          <h2>
            <span className="mono">{machine.machineCode}</span> — {machine.name}
          </h2>
          <p className="lede">
            {[
              machine.location.site,
              machine.location.building,
              machine.location.productionLine,
              machine.location.area,
            ]
              .filter(Boolean)
              .join(" · ") || "Location not recorded"}
          </p>
        </div>
        <div className="row">
          <StatusBadge
            status={machine.status}
            label={labelMachineStatus(machine.status)}
          />
          <ButtonLink to={`${base}/report-issue?machine=${machine.id}`} variant="secondary">
            Report issue
          </ButtonLink>
          <ButtonLink to={`${base}/voice?machine=${machine.id}`} variant="primary">
            Ask about this machine
          </ButtonLink>
        </div>
      </header>
      <div className="notice">
        Example machine context. EchoFloor is not reporting live pressure, speed, or
        health.
      </div>
      <div className="card-grid">
        <article className="card">
          <span className="card-kicker">Type</span>
          <strong>{machine.machineType ?? "Not recorded"}</strong>
        </article>
        <article className="card">
          <span className="card-kicker">NFC</span>
          <strong>
            {machine.nfc.enabled && machine.nfc.tagId
              ? machine.nfc.tagId
              : "Not configured"}
          </strong>
        </article>
        <article className="card">
          <span className="card-kicker">Open reports</span>
          <strong>{unresolvedMemories(memories).length}</strong>
        </article>
      </div>
      {machine.description ? <p>{machine.description}</p> : null}
      <section className="stack">
        <h3>Constraints</h3>
        {constraints.length === 0 ? (
          <EmptyState
            title="No constraints"
            message="No time-bounded instructions are stored for this machine."
          />
        ) : (
          constraints.map((constraint) => (
            <article key={constraint.id} className="card stack">
              <div className="spread">
                <strong>{constraint.title}</strong>
                <StatusBadge
                  status={constraintDisplayStatus(constraint, now)}
                  label={constraintDisplayStatus(constraint, now)}
                />
              </div>
              <p>{constraint.description}</p>
              <p className="muted">
                {labelSeverity(constraint.severity)}. Stored status: {constraint.status}.{" "}
                {isConstraintActive(constraint, now)
                  ? "Treated as active because the window is open."
                  : "Not treated as active guidance."}{" "}
                {constraint.expiresAt
                  ? `Expiry ${formatTimestamp(constraint.expiresAt, timezone)}.`
                  : ""}
              </p>
            </article>
          ))
        )}
      </section>
      <section className="stack">
        <div className="spread">
          <h3>Operational memory</h3>
          {role === "admin" ? (
            <Link to={`/admin/memories?machine=${machine.id}`}>
              Open in Memory Explorer
            </Link>
          ) : null}
        </div>
        {role === "worker" ? (
          <p className="muted">
            You can read these records and submit a new report. Existing records cannot be
            edited here.
          </p>
        ) : null}
        {memories.length === 0 ? (
          <EmptyState
            title="No memories yet"
            message="Use the Voice Assistant to record the first observation."
          />
        ) : (
          <ol className="timeline">
            {memories.map((memory) => (
              <li key={memory.id} className="card stack">
                <div className="spread">
                  <strong>{memory.title}</strong>
                  <StatusBadge
                    status={memory.status}
                    label={labelMemoryStatus(memory.status)}
                  />
                </div>
                <span className="muted">
                  {labelMemoryType(memory.type)} ·{" "}
                  {formatTimestamp(memory.createdAt, timezone)} ·{" "}
                  {userById(db, memory.source.submittedBy ?? memory.createdBy)
                    ?.displayName ?? "Unknown source"}
                  {memory.status === "verified" ? "" : " · Not verified"}
                </span>
                <p>{memory.content}</p>
                {role === "admin" ? (
                  <Link to={`/admin/memories/${memory.id}`}>Review record</Link>
                ) : null}
                {role === "worker" ? (
                  <Link to={`/worker/voice?machine=${machine.id}`}>
                    Submit a correction as a new report
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="stack">
        <h3>Active Live Alerts</h3>
        {liveAlerts.length === 0 ? (
          <EmptyState
            title="No active Live Alerts"
            message="Damage, maintenance holds, and hazard warnings for this machine appear here while their window is open."
          />
        ) : (
          liveAlerts.map((alert) => (
            <Link key={alert.id} className="list-card" to={`${base}/alerts/${alert.id}`}>
              <div className="spread">
                <strong>{alert.title}</strong>
                <StatusBadge status={alert.severity} label={labelSeverity(alert.severity)} />
              </div>
              <span className="muted">
                {alert.expiresAt
                  ? `Until ${formatTimestamp(alert.expiresAt, timezone)}`
                  : "No expiry recorded"}
              </span>
              <span>{alert.message}</span>
            </Link>
          ))
        )}
      </section>
      <section className="stack">
        <h3>Machine information notices</h3>
        <p className="muted">
          Informational items such as pending reviews. These are not shown in Live Alerts.
        </p>
        {infoNotices.length === 0 ? (
          <EmptyState
            title="No informational notices"
            message="Pending reviews and other non-urgent notices for this machine appear here."
          />
        ) : (
          infoNotices.map((notice) => (
            <article key={notice.id} className="list-card">
              <strong>{notice.title}</strong>
              <span className="muted">{notice.message}</span>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
