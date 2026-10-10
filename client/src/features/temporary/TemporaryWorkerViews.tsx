import { Link, useParams } from "react-router-dom";
import { ButtonLink } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  labelMemoryStatus,
  labelMemoryType,
} from "@/domain/labels";
import { damageRepairMemoriesFor } from "@/domain/workSummary";
import {
  machineById,
  machinesFor,
  userById,
} from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { demoStore } from "@/services/demoStore";
import { formatTimestamp } from "@/utils/format";
import { useState } from "react";

export function DamageRepairListPage() {
  const db = useDemoDatabase();
  const session = db.session;
  const machines = session ? machinesFor(db, session.organisationId) : [];
  const [machineFilter, setMachineFilter] = useState(
    db.selectedMachineId ?? "all",
  );
  if (!session) return null;
  const timezone =
    db.organisations.find((item) => item.id === session.organisationId)?.settings
      .timezone ?? "UTC";
  const memories = damageRepairMemoriesFor(
    db,
    session.organisationId,
    machineFilter === "all" ? undefined : machineFilter,
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>History</h2>
          <p className="lede">
            Previous damage and repair records as a dated log. Daily work-log detail is
            not included.
          </p>
        </div>
      </header>
      <Field label="Machine" htmlFor="history-machine">
        <select
          id="history-machine"
          value={machineFilter}
          onChange={(event) => {
            const value = event.target.value;
            setMachineFilter(value);
            if (value !== "all") demoStore.selectMachine(value);
          }}
        >
          <option value="all">All machines</option>
          {machines.map((machine) => (
            <option key={machine.id} value={machine.id}>
              {machine.machineCode} — {machine.name}
            </option>
          ))}
        </select>
      </Field>
      {memories.length === 0 ? (
        <EmptyState
          title="No history yet"
          message="Damage and repair records for the selected machines will appear here as a log."
        />
      ) : (
        <ol className="history-log">
          {memories.map((memory) => {
            const machine = machineById(db, session.organisationId, memory.machineId);
            return (
              <li key={memory.id}>
                <Link className="history-log-item" to={`/worker/history/${memory.id}`}>
                  <time dateTime={memory.createdAt} className="history-log-time">
                    {formatTimestamp(memory.createdAt, timezone)}
                  </time>
                  <div className="history-log-body">
                    <div className="spread">
                      <strong>{memory.title}</strong>
                      <StatusBadge
                        status={memory.status}
                        label={labelMemoryStatus(memory.status)}
                      />
                    </div>
                    <span className="muted">
                      {machine ? (
                        <>
                          <span className="mono">{machine.machineCode}</span> —{" "}
                          {machine.name}
                        </>
                      ) : (
                        "Machine unavailable"
                      )}{" "}
                      · {labelMemoryType(memory.type)}
                      {memory.example ? " · Example historical knowledge" : ""}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function DamageRepairDetailPage() {
  const { memoryId = "" } = useParams();
  const db = useDemoDatabase();
  const session = db.session;
  if (!session) return null;
  const memory = damageRepairMemoriesFor(db, session.organisationId).find(
    (item) => item.id === memoryId,
  );
  const timezone =
    db.organisations.find((item) => item.id === session.organisationId)?.settings
      .timezone ?? "UTC";

  if (!memory) {
    return (
      <div className="page">
        <EmptyState
          title="Record not available"
          message="That record is not damage or repair history in this organisation, or it is a daily work log that temporary workers cannot open in detail."
          action={<ButtonLink to="/worker/history">Back to history</ButtonLink>}
        />
      </div>
    );
  }

  const machine = machineById(db, session.organisationId, memory.machineId);
  const author = userById(db, memory.source.submittedBy ?? memory.createdBy);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="muted">
            <Link to="/worker/history">History</Link>
          </p>
          <h2>{memory.title}</h2>
          <p className="lede">
            <time dateTime={memory.createdAt}>
              {formatTimestamp(memory.createdAt, timezone)}
            </time>
            {" · "}
            {machine ? (
              <>
                <span className="mono">{machine.machineCode}</span> — {machine.name}
              </>
            ) : (
              "Machine unavailable"
            )}
          </p>
        </div>
        <StatusBadge status={memory.status} label={labelMemoryStatus(memory.status)} />
      </header>
      {memory.example ? (
        <div className="notice">
          Example historical knowledge. Not live telemetry or a verified plant reading.
        </div>
      ) : null}
      <article className="card stack">
        <span className="muted">
          {labelMemoryType(memory.type)} · {author?.displayName ?? "Unknown source"}
        </span>
        <p>{memory.content}</p>
        {memory.resolution ? (
          <p>
            <strong>Resolution:</strong> {memory.resolution.description}
          </p>
        ) : null}
        {memory.machineContext?.component ? (
          <p className="muted">Component: {memory.machineContext.component}</p>
        ) : null}
        <ButtonLink to={`/worker/voice?machine=${memory.machineId}`} variant="primary">
          Ask about this machine
        </ButtonLink>
      </article>
    </div>
  );
}
