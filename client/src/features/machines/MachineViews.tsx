import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/Button";
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
import { MachineForm } from "@/features/machines/MachineForm";
import { blobFilename } from "@/features/voice/liveVoiceRecording";
import { useDemoDatabase } from "@/hooks/useDemo";
import { pollVoiceReport, postVoiceReport } from "@/services/n8nApi";
import { useToast } from "@/components/ui/Toast";
import { formatTimestamp } from "@/utils/format";

const REPORT_MAX_SECONDS = 120;

function MachineVoiceReport({
  machineId,
  userId,
  organisationId,
}: {
  machineId: string;
  userId: string;
  organisationId: string;
}) {
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    setMessage("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("This browser cannot capture audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorderRef.current = recorder;
      recorder.start(500);
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds((value) => {
          if (value + 1 >= REPORT_MAX_SECONDS) {
            void stop();
            return REPORT_MAX_SECONDS;
          }
          return value + 1;
        });
      }, 1000);
    } catch {
      setMessage("Microphone access was denied or is unavailable.");
    }
  }

  async function stop() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      return;
    }
    setPending(true);
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRecording(false);
    const blob = chunksRef.current.length
      ? new Blob(chunksRef.current, { type: recorder.mimeType })
      : null;
    if (!blob || blob.size === 0) {
      setPending(false);
      setMessage("No audio was captured.");
      return;
    }
    const posted = await postVoiceReport(
      { userId, organisationId },
      { machineId, audioBlob: blob, filename: blobFilename(blob) },
    );
    if (!posted.ok) {
      setPending(false);
      setMessage(posted.message);
      return;
    }
    const polled = await pollVoiceReport({ userId, organisationId }, posted.requestId);
    setPending(false);
    if (!polled.ok) {
      setMessage(polled.message);
      return;
    }
    if (polled.data.status === "failed") {
      setMessage(polled.data.errorMessage ?? "Voice report workflow failed.");
      return;
    }
    toast.push("Voice report accepted by n8n. Refresh workspace to see new memories.");
    setMessage("Report submitted. n8n will create or update operational records.");
  }

  return (
    <section className="card stack">
      <h3>Report by voice (live)</h3>
      <p className="muted">
        Record up to {REPORT_MAX_SECONDS / 60} minutes. Audio is uploaded to{" "}
        <span className="mono">POST /reports/voice</span>, not directly to n8n.
      </p>
      <div className="row">
        {!recording ? (
          <Button onClick={() => void start()} disabled={pending}>
            Record report
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => void stop()} data-recording="true">
            Stop · {seconds}s
          </Button>
        )}
      </div>
      {pending ? <p className="muted">Uploading and waiting for n8n…</p> : null}
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function MachineListPage({ role }: { role: "admin" | "worker" }) {
  const db = useDemoDatabase();
  const session = db.session;
  const [text, setText] = useState("");
  const [line, setLine] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  if (!session) return null;
  const base = role === "admin" ? "/admin" : "/worker";
  const orgMachines = machinesFor(db, session.organisationId);
  const machines = orgMachines.filter((machine) => {
    const haystack = `${machine.machineCode} ${machine.name}`.toLowerCase();
    const matchesText = haystack.includes(text.trim().toLowerCase());
    const matchesLine =
      line === "all" || (machine.location.productionLine ?? "") === line;
    return matchesText && matchesLine;
  });
  const lines = [
    ...new Set(
      orgMachines
        .map((machine) => machine.location.productionLine)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const memories = db.memories.filter(
    (memory) => memory.organisationId === session.organisationId,
  );
  const addOpen = showAdd || (role === "admin" && orgMachines.length === 0);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Machines</h2>
          <p className="lede">
            Search by identifier or name. Record status is not a live health reading.
          </p>
        </div>
        {role === "admin" && orgMachines.length > 0 ? (
          <Button
            variant={addOpen ? "secondary" : "primary"}
            onClick={() => setShowAdd((value) => !value)}
          >
            {addOpen ? "Hide add form" : "Add a machine"}
          </Button>
        ) : null}
      </header>
      {role === "admin" && addOpen ? (
        <MachineForm
          onSaved={() => {
            if (orgMachines.length > 0) setShowAdd(false);
          }}
        />
      ) : null}
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
            orgMachines.length === 0
              ? "This organisation has no machines yet. Register one above."
              : "Try a different identifier, name, or line."
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
  const [editing, setEditing] = useState(false);
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
          {role === "admin" ? (
            <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
              {editing ? "Close editor" : "Edit machine"}
            </Button>
          ) : null}
          <ButtonLink to={`${base}/report-issue?machine=${machine.id}`} variant="secondary">
            Report issue
          </ButtonLink>
          <ButtonLink to={`${base}/voice?machine=${machine.id}`} variant="primary">
            Ask about this machine
          </ButtonLink>
        </div>
      </header>
      {role === "admin" && editing ? (
        <MachineForm
          machine={machine}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : null}
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
      {session.live ? (
        <MachineVoiceReport
          machineId={machine.id}
          userId={session.userId}
          organisationId={session.organisationId}
        />
      ) : null}
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
