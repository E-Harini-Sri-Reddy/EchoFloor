import { useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import {
  MAX_ISSUE_PHOTO_BYTES,
  issueDurationPresets,
  labelMachineIssueKind,
} from "@/domain/alerts";
import { machinesFor } from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
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
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [photoBytes, setPhotoBytes] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!session) return null;

  const alertsPath = role === "admin" ? "/admin/alerts" : "/worker/alerts";

  async function onPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setErrors((current) => ({ ...current, photo: "" }));
    if (!file) {
      setPhotoDataUrl("");
      setPhotoName("");
      setPhotoBytes(0);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setErrors((current) => ({
        ...current,
        photo: "Choose an image file (for example JPG or PNG).",
      }));
      return;
    }
    if (file.size > MAX_ISSUE_PHOTO_BYTES) {
      setErrors((current) => ({
        ...current,
        photo: "Use a photo smaller than about 1.5 MB for this preview.",
      }));
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setPhotoDataUrl(dataUrl);
    setPhotoName(file.name);
    setPhotoBytes(file.size);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const preset = issueDurationPresets().find((item) => item.id === durationId);
    let expiresAt = "";
    if (durationId === "custom") {
      expiresAt = customEnd ? new Date(customEnd).toISOString() : "";
    } else if (preset) {
      expiresAt = new Date(Date.now() + preset.hours * 60 * 60 * 1000).toISOString();
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const result = demoStore.reportMachineIssue({
      machineId,
      issueKind,
      title,
      description,
      expiresAt,
      photoDataUrl,
      photoName,
      photoBytes,
    });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      toast.push(result.message);
      return;
    }
    toast.push(
      "Issue reported in this browser session. It appears in Live Alerts until the window ends. The photo was not uploaded to a server.",
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
            required. The alert stays in Live Alerts only until the chosen window ends.
          </p>
        </div>
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
        <Field
          label="Photo of the issue"
          htmlFor="issue-photo"
          error={errors.photo}
          hint="Required. Kept in this browser session only — not sent to a server in this preview."
        >
          <input
            id="issue-photo"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => void onPhotoChange(event)}
          />
        </Field>
        {photoDataUrl ? (
          <figure className="issue-photo-preview">
            <img src={photoDataUrl} alt="Selected issue photo preview" />
            <figcaption className="muted">
              {photoName} · {Math.round(photoBytes / 1024)} KB
            </figcaption>
          </figure>
        ) : null}
        <Button type="submit" loading={saving}>
          Submit issue report
        </Button>
      </form>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the photo."));
    reader.readAsDataURL(file);
  });
}
