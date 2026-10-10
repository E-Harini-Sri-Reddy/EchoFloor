import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import {
  issueDurationPresets,
  labelMachineIssueKind,
} from "@/domain/alerts";
import {
  IssuePhotoCapture,
  type IssuePhotoValue,
} from "@/features/alerts/IssuePhotoCapture";
import { machinesFor } from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import { apiReportMachineIssue } from "@/services/apiClient";
import { demoStore } from "@/services/demoStore";
import type { MachineIssueKind } from "@/types/domain";

const ISSUE_KINDS: MachineIssueKind[] = [
  "breakdown",
  "damage",
  "maintenance",
  "overheating",
  "unsafe",
];

export function ReportIssuePage({ role }: { role: "admin" | "worker" }) {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const machines = session ? machinesFor(db, session.organisationId) : [];
  const [machineId, setMachineId] = useState(
    params.get("machine") || db.selectedMachineId || machines[0]?.id || "",
  );
  const [issueKind, setIssueKind] = useState<MachineIssueKind>("breakdown");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [durationId, setDurationId] = useState("2h");
  const [customEnd, setCustomEnd] = useState("");
  const [photo, setPhoto] = useState<IssuePhotoValue | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!session) return null;
  const activeSession = session;

  const alertsPath =
    role === "admin" ? "/admin/issues/alerts" : "/worker/issues/alerts";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    const preset = issueDurationPresets().find((item) => item.id === durationId);
    let expiresAt = "";
    if (durationId === "custom") {
      expiresAt = customEnd ? new Date(customEnd).toISOString() : "";
    } else if (preset) {
      expiresAt = new Date(Date.now() + preset.hours * 60 * 60 * 1000).toISOString();
    }

    const payload = {
      machineId,
      issueKind,
      title,
      description,
      expiresAt,
      photoDataUrl: photo?.dataUrl ?? "",
      photoName: photo?.name ?? "",
      photoBytes: photo?.bytes ?? 0,
      photoSource: (photo?.source ?? "upload") as "camera" | "upload",
    };

    if (activeSession.live) {
      const remote = await apiReportMachineIssue({
        organisationId: activeSession.organisationId,
        reportedBy: activeSession.userId,
        ...payload,
      });
      setSaving(false);
      if (!remote.ok) {
        setErrors(remote.fieldErrors ?? {});
        toast.push(remote.message);
        return;
      }
      demoStore.hydrateLive(remote.data.workspace, remote.data.session);
      toast.push(
        "Issue reported and saved to the database. The photo is queued for admin review.",
      );
      navigate(alertsPath);
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const result = demoStore.reportMachineIssue(payload);
    setSaving(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast.push(result.message);
      return;
    }
    toast.push(
      "Issue reported. The photo is queued for AI false-report screening and an administrator should review it. Stored in this browser session only.",
    );
    navigate(alertsPath);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Report a machine issue</h2>
          <p className="lede">
            Report breakdown, damage, maintenance holds, or unsafe conditions. A photo is
            required — take one with the camera or upload from this device. AI will later
            screen photos for possible false reports and ask an administrator to look into
            flagged cases.
          </p>
        </div>
        <ButtonLink to={alertsPath} variant="secondary">
          View Live Alerts
        </ButtonLink>
      </header>
      <form className="card form-grid" onSubmit={onSubmit} noValidate>
        <Field label="Machine" htmlFor="issue-machine" error={errors.machineId}>
          <select
            id="issue-machine"
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
        <Field label="Issue type" htmlFor="issue-kind" error={errors.issueKind}>
          <select
            id="issue-kind"
            value={issueKind}
            onChange={(event) => setIssueKind(event.target.value as MachineIssueKind)}
          >
            {ISSUE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {labelMachineIssueKind(kind)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" htmlFor="issue-title" error={errors.title}>
          <TextInput
            id="issue-title"
            value={title}
            error={errors.title}
            placeholder="Hydraulic leak at the press head"
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field label="What is wrong" htmlFor="issue-description" error={errors.description}>
          <textarea
            id="issue-description"
            value={description}
            aria-invalid={errors.description ? true : undefined}
            placeholder="Describe the breakdown, damage, or why the machine must not be operated."
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field
          label="Alert / do-not-operate window"
          htmlFor="issue-duration"
          error={errors.expiresAt}
          hint="When this window ends, the item leaves Live Alerts automatically."
        >
          <select
            id="issue-duration"
            value={durationId}
            onChange={(event) => setDurationId(event.target.value)}
          >
            {issueDurationPresets().map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </Field>
        {durationId === "custom" ? (
          <Field label="Window ends" htmlFor="issue-custom-end">
            <TextInput
              id="issue-custom-end"
              type="datetime-local"
              value={customEnd}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
          </Field>
        ) : null}

        <IssuePhotoCapture
          value={photo}
          error={errors.photo}
          onChange={(next) => {
            setPhoto(next);
            setErrors((current) => ({ ...current, photo: "" }));
          }}
          onError={(message) => setErrors((current) => ({ ...current, photo: message }))}
        />

        <div className="row">
          <Button type="submit" loading={saving}>
            Submit issue report
          </Button>
          <Link className="btn btn-tertiary" to={alertsPath}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
