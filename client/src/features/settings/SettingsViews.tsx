import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import {
  membershipAccessState,
  workerAccessTypeOf,
} from "@/domain/access";
import {
  labelAccessDuration,
  labelRole,
  labelWorkerAccessType,
} from "@/domain/labels";
import { memberRows } from "@/domain/queries";
import { useDemoDatabase } from "@/hooks/useDemo";
import {
  apiAddMember,
  apiLeaveOrganisation,
  apiRemoveMember,
} from "@/services/apiClient";
import {
  fetchHealth,
  getClientConfig,
  type HealthPayload,
} from "@/services/clientConfig";
import { demoStore } from "@/services/demoStore";
import type { WorkerAccessDuration, WorkerAccessType } from "@/types/domain";
import { formatTimestamp } from "@/utils/format";

const TIMEZONES = ["Asia/Kolkata", "Europe/London", "America/New_York", "UTC"];

export function SettingsPage({ role }: { role: "admin" | "worker" }) {
  const db = useDemoDatabase();
  const session = db.session;
  const [section, setSection] = useState(role === "admin" ? "organisation" : "account");
  if (!session) return null;
  const sections =
    role === "admin"
      ? [
          ["organisation", "Organisation"],
          ["account", "Account"],
          ["integrations", "Integrations"],
        ]
      : [
          ["account", "Account"],
          ["notifications", "Notifications"],
        ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Settings</h2>
          <p className="lede">
            {role === "admin"
              ? "Organisation and account settings. Members are managed under Users."
              : "Personal settings only. Organisation configuration is not available to workers."}
          </p>
        </div>
      </header>
      <div className="tabs" role="tablist">
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="tab"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {section === "organisation" && role === "admin" ? <OrganisationSettings /> : null}
      {section === "account" ? <AccountSettings /> : null}
      {section === "notifications" && role === "worker" ? (
        <AccountSettings notificationsOnly />
      ) : null}
      {section === "integrations" && role === "admin" ? <IntegrationSettings /> : null}
    </div>
  );
}

export function UsersPage() {
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h2>Users</h2>
          <p className="lede">
            Add members and manage worker access for this organisation.
          </p>
        </div>
      </header>
      <MemberSettings />
    </div>
  );
}

function OrganisationSettings() {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const organisation = db.organisations.find(
    (item) => item.id === session?.organisationId,
  );
  const [name, setName] = useState(organisation?.name ?? "");
  const [timezone, setTimezone] = useState(organisation?.settings.timezone ?? "UTC");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  if (!organisation) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const result = demoStore.updateOrganisation({ name, timezone });
    setSaving(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      return;
    }
    setErrors({});
    toast.push("Organisation settings saved in this browser session.");
  }

  return (
    <form className="card form-grid" onSubmit={onSubmit} noValidate>
      <Field label="Organisation name" htmlFor="settings-org-name" error={errors.name}>
        <TextInput
          id="settings-org-name"
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field
        label="Identifier"
        htmlFor="settings-slug"
        hint="The slug is fixed after creation in this preview."
      >
        <TextInput id="settings-slug" value={organisation.slug} readOnly />
      </Field>
      <Field label="Timezone" htmlFor="settings-timezone" error={errors.timezone}>
        <select
          id="settings-timezone"
          value={timezone}
          onChange={(event) => setTimezone(event.target.value)}
        >
          {TIMEZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </Field>
      <Button type="submit" loading={saving}>
        Save organisation
      </Button>
    </form>
  );
}

function MemberSettings() {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [workerAccessType, setWorkerAccessType] =
    useState<WorkerAccessType>("permanent");
  const [accessDuration, setAccessDuration] =
    useState<WorkerAccessDuration>("until_removed");
  const [customExpiresAt, setCustomExpiresAt] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  if (!session) return null;
  const members = memberRows(db, session.organisationId);
  const invitations = db.invitations.filter(
    (invitation) => invitation.organisationId === session.organisationId,
  );

  function onAccessTypeChange(next: WorkerAccessType) {
    setWorkerAccessType(next);
    setAccessDuration(next === "permanent" ? "until_removed" : "24h");
    setCustomExpiresAt("");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    const activeSession = session;
    setSaving(true);
    try {
      if (activeSession.live) {
        const result = await apiAddMember({
          organisationId: activeSession.organisationId,
          addedBy: activeSession.userId,
          email,
          temporaryPassword,
          workerAccessType,
          accessDuration,
          customExpiresAt: accessDuration === "custom" ? customExpiresAt : undefined,
        });
        if (!result.ok) {
          setErrors(result.fieldErrors ?? { email: result.message });
          return;
        }
        demoStore.hydrateLive(result.data.workspace, result.data.session);
      } else {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        const result = demoStore.addMember({
          email,
          temporaryPassword,
          workerAccessType,
          accessDuration,
          customExpiresAt: accessDuration === "custom" ? customExpiresAt : undefined,
        });
        if (!result.ok) {
          setErrors(result.fieldErrors ?? { email: result.message });
          return;
        }
      }
      setErrors({});
      setEmail("");
      setTemporaryPassword("");
      setWorkerAccessType("permanent");
      setAccessDuration("until_removed");
      setCustomExpiresAt("");
      toast.push(
        activeSession.live
          ? `${labelWorkerAccessType(workerAccessType)} member saved to the database. They can sign in with the temporary password or Google on the same email.`
          : `${labelWorkerAccessType(workerAccessType)} member recorded with a temporary password. They can also sign in with Google using the same email.`,
      );
    } finally {
      setSaving(false);
    }
  }

  async function onRemoveMember(membershipId: string) {
    if (!session) return;
    setRemoveBusy(true);
    try {
      if (session.live) {
        const result = await apiRemoveMember({
          membershipId,
          organisationId: session.organisationId,
          removedBy: session.userId,
          confirm: true,
        });
        if (!result.ok) {
          toast.push(result.message);
          return;
        }
        demoStore.hydrateLive(result.data.workspace, result.data.session);
      } else {
        const result = demoStore.removeMember(membershipId);
        if (!result.ok) {
          toast.push(result.message);
          return;
        }
      }
      setRemovingId(null);
      toast.push("Member removed from the organisation.");
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="card form-grid" onSubmit={onSubmit} noValidate>
        <h3>Add a member</h3>
        <p className="muted">
          Add their email and a temporary password. That creates their membership
          {session.live ? " in the database" : " in this browser session"}. They sign in
          with that password or with Google on the same email (same user id). This form
          cannot assign an administrator.
        </p>
        <Field label="Email" htmlFor="member-email" error={errors.email}>
          <TextInput
            id="member-email"
            type="email"
            value={email}
            error={errors.email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field
          label="Temporary password"
          htmlFor="member-password"
          error={errors.temporaryPassword}
          hint="At least 8 characters. Share it out of band; email delivery is not configured."
        >
          <TextInput
            id="member-password"
            type="password"
            autoComplete="new-password"
            value={temporaryPassword}
            error={errors.temporaryPassword}
            onChange={(event) => setTemporaryPassword(event.target.value)}
          />
        </Field>
        <Field label="Member type" htmlFor="member-type">
          <select
            id="member-type"
            value={workerAccessType}
            onChange={(event) =>
              onAccessTypeChange(event.target.value as WorkerAccessType)
            }
          >
            <option value="permanent">Permanent worker</option>
            <option value="temporary">Temporary worker</option>
          </select>
        </Field>
        <Field
          label="Login access"
          htmlFor="member-duration"
          error={errors.accessDuration}
          hint={
            workerAccessType === "permanent"
              ? "Permanent members stay until manual removal or until they leave. Use Suspend on their member card."
              : "Temporary members cannot be suspended. Access ends when the window expires."
          }
        >
          <select
            id="member-duration"
            value={accessDuration}
            onChange={(event) =>
              setAccessDuration(event.target.value as WorkerAccessDuration)
            }
          >
            {workerAccessType === "permanent" ? (
              <option value="until_removed">Until manual removal</option>
            ) : (
              <>
                <option value="24h">24 hours</option>
                <option value="1w">1 week</option>
                <option value="1m">1 month</option>
                <option value="custom">Custom end date</option>
              </>
            )}
          </select>
        </Field>
        {workerAccessType === "temporary" && accessDuration === "custom" ? (
          <Field label="Access ends" htmlFor="member-custom-end">
            <TextInput
              id="member-custom-end"
              type="datetime-local"
              value={customExpiresAt}
              onChange={(event) => setCustomExpiresAt(event.target.value)}
            />
          </Field>
        ) : null}
        <Button type="submit" loading={saving}>
          Add member
        </Button>
      </form>
      <div className="stack">
        {members.map(({ membership, user }) => {
          const accessType = workerAccessTypeOf(membership);
          const state = membershipAccessState(membership);
          return (
            <article key={membership.id} className="card stack">
              <div className="spread">
                <strong>{user?.displayName}</strong>
                <StatusBadge
                  status={
                    membership.role === "admin"
                      ? "info"
                      : state === "suspended" || state === "expired"
                        ? "warning"
                        : "neutral"
                  }
                  label={
                    membership.role === "admin"
                      ? labelRole("admin")
                      : labelWorkerAccessType(accessType)
                  }
                />
              </div>
              <span className="muted">{user?.email}</span>
              <span className="muted">
                Status: {state}
                {membership.role === "worker" && membership.accessDurationPreset
                  ? ` · ${labelAccessDuration(membership.accessDurationPreset)}`
                  : ""}
                {membership.accessExpiresAt
                  ? ` · ends ${formatTimestamp(membership.accessExpiresAt)}`
                  : membership.role === "worker" && accessType === "permanent"
                    ? " · until manual removal"
                    : ""}
              </span>
              {membership.role === "worker" ? (
                <div className="row">
                  {accessType === "permanent" ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const result = demoStore.setPermanentWorkerSuspension(
                          membership.id,
                          membership.status !== "suspended",
                        );
                        if (!result.ok) {
                          toast.push(result.message);
                          return;
                        }
                        toast.push(
                          membership.status === "suspended"
                            ? "Permanent worker restored in this browser session."
                            : "Permanent worker suspended in this browser session.",
                        );
                      }}
                    >
                      {membership.status === "suspended" ? "Restore access" : "Suspend"}
                    </Button>
                  ) : (
                    <span className="muted">
                      Temporary access ends automatically. Suspension is not used.
                    </span>
                  )}
                  <Button
                    variant="tertiary"
                    onClick={() =>
                      setEditingId(editingId === membership.id ? null : membership.id)
                    }
                  >
                    {editingId === membership.id ? "Close" : "Change access"}
                  </Button>
                </div>
              ) : null}
              {editingId === membership.id ? (
                <MemberAccessEditor
                  membershipId={membership.id}
                  initialType={accessType ?? "permanent"}
                  initialDuration={
                    membership.accessDurationPreset ??
                    (accessType === "temporary" ? "1w" : "until_removed")
                  }
                  onDone={() => setEditingId(null)}
                />
              ) : null}
              {membership.userId !== session.userId ? (
                removingId === membership.id ? (
                  <div className="stack">
                    <p className="muted">
                      Remove {user?.displayName ?? "this member"} from the organisation?
                      They will lose access immediately.
                    </p>
                    <div className="row">
                      <Button
                        variant="destructive"
                        loading={removeBusy}
                        onClick={() => void onRemoveMember(membership.id)}
                      >
                        Confirm remove
                      </Button>
                      <Button
                        variant="tertiary"
                        disabled={removeBusy}
                        onClick={() => setRemovingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="row">
                    <Button
                      variant="destructive"
                      onClick={() => setRemovingId(membership.id)}
                    >
                      Remove
                    </Button>
                  </div>
                )
              ) : null}
            </article>
          );
        })}
      </div>
      <h3>Recently added</h3>
      {invitations.length === 0 ? (
        <EmptyState
          title="No recent adds"
          message="Members you add are listed here for reference."
        />
      ) : (
        invitations.map((invitation) => (
          <article key={invitation.id} className="list-card">
            <strong>{invitation.emailNormalized}</strong>
            <span className="muted">
              {labelWorkerAccessType(invitation.workerAccessType)} ·{" "}
              {labelAccessDuration(invitation.accessDurationPreset)} · {invitation.status}
              {invitation.accessExpiresAt
                ? ` · login ends ${formatTimestamp(invitation.accessExpiresAt)}`
                : ""}
            </span>
          </article>
        ))
      )}
    </div>
  );
}

function MemberAccessEditor({
  membershipId,
  initialType,
  initialDuration,
  onDone,
}: {
  membershipId: string;
  initialType: WorkerAccessType;
  initialDuration: WorkerAccessDuration;
  onDone: () => void;
}) {
  const toast = useToast();
  const [workerAccessType, setWorkerAccessType] = useState(initialType);
  const [accessDuration, setAccessDuration] = useState(initialDuration);
  const [customExpiresAt, setCustomExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    const result = demoStore.updateWorkerAccessWindow(membershipId, {
      workerAccessType,
      accessDuration,
      customExpiresAt: accessDuration === "custom" ? customExpiresAt : undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.fieldErrors?.accessDuration ?? result.message);
      return;
    }
    toast.push("Worker access updated in this browser session.");
    onDone();
  }

  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <Field label="Worker type" htmlFor={`edit-type-${membershipId}`}>
        <select
          id={`edit-type-${membershipId}`}
          value={workerAccessType}
          onChange={(event) => {
            const next = event.target.value as WorkerAccessType;
            setWorkerAccessType(next);
            setAccessDuration(next === "permanent" ? "until_removed" : "24h");
          }}
        >
          <option value="permanent">Permanent worker</option>
          <option value="temporary">Temporary worker</option>
        </select>
      </Field>
      <Field
        label="Login access"
        htmlFor={`edit-duration-${membershipId}`}
        error={error}
      >
        <select
          id={`edit-duration-${membershipId}`}
          value={accessDuration}
          onChange={(event) =>
            setAccessDuration(event.target.value as WorkerAccessDuration)
          }
        >
          {workerAccessType === "permanent" ? (
            <option value="until_removed">Until manual removal</option>
          ) : (
            <>
              <option value="24h">24 hours</option>
              <option value="1w">1 week</option>
              <option value="1m">1 month</option>
              <option value="custom">Custom end date</option>
            </>
          )}
        </select>
      </Field>
      {workerAccessType === "temporary" && accessDuration === "custom" ? (
        <Field label="Access ends" htmlFor={`edit-custom-${membershipId}`}>
          <TextInput
            id={`edit-custom-${membershipId}`}
            type="datetime-local"
            value={customExpiresAt}
            onChange={(event) => setCustomExpiresAt(event.target.value)}
          />
        </Field>
      ) : null}
      <Button type="submit" loading={saving}>
        Save access window
      </Button>
    </form>
  );
}

function AccountSettings({ notificationsOnly = false }: { notificationsOnly?: boolean }) {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const prefs = session ? db.preferences[session.userId] : undefined;
  const organisation = session
    ? db.organisations.find((item) => item.id === session.organisationId)
    : undefined;
  const [displayName, setDisplayName] = useState(session?.displayName ?? "");
  const [emailAlerts, setEmailAlerts] = useState(prefs?.emailAlerts ?? false);
  const [showVoiceTextFirst, setShowVoiceTextFirst] = useState(
    prefs?.showVoiceTextFirst ?? false,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [leaveStep, setLeaveStep] = useState<0 | 1 | 2>(0);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState("");
  if (!session) return null;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const result = demoStore.updatePreferences({
      displayName,
      emailAlerts,
      showVoiceTextFirst,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.fieldErrors?.displayName ?? result.message);
      return;
    }
    setError("");
    toast.push("Account preferences saved in this browser session.");
  }

  async function confirmLeaveOrganisation() {
    if (!session) return;
    setLeaving(true);
    setLeaveError("");
    try {
      if (session.live) {
        const result = await apiLeaveOrganisation({
          userId: session.userId,
          organisationId: session.organisationId,
          confirm: true,
        });
        if (!result.ok) {
          setLeaveError(result.message);
          setLeaveStep(1);
          return;
        }
        demoStore.logout();
      } else {
        const result = demoStore.leaveOrganisation();
        if (!result.ok) {
          setLeaveError(result.message);
          setLeaveStep(1);
          return;
        }
      }
      toast.push("You left the organisation.");
      window.location.assign("/");
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="stack">
      <form className="card form-grid" onSubmit={onSubmit} noValidate>
        {notificationsOnly ? null : (
          <>
            <Field label="Name" htmlFor="account-name" error={error}>
              <TextInput
                id="account-name"
                value={displayName}
                error={error}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </Field>
            <Field
              label="Email"
              htmlFor="account-email"
              hint="Email changes are not available in this preview."
            >
              <TextInput id="account-email" value={session.email} readOnly />
            </Field>
          </>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={emailAlerts}
            onChange={(event) => setEmailAlerts(event.target.checked)}
          />
          Email alert preference (not delivered; no mail provider is configured)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={showVoiceTextFirst}
            onChange={(event) => setShowVoiceTextFirst(event.target.checked)}
          />
          Prefer typing over the microphone
        </label>
        <Button type="submit" loading={saving}>
          Save account
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            demoStore.logout();
            window.location.assign("/");
          }}
        >
          Sign out
        </Button>
      </form>

      {notificationsOnly ? null : (
        <section className="card stack">
          <h3>Leave organisation</h3>
          <p className="muted">
            Leave {organisation?.name ?? "this organisation"}. You will lose access until an
            administrator adds you again. This requires two confirmations.
          </p>
          {leaveError ? (
            <p className="notice notice-danger" role="alert">
              {leaveError}
            </p>
          ) : null}
          {leaveStep === 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                setLeaveError("");
                setLeaveStep(1);
              }}
            >
              Leave organisation
            </Button>
          ) : null}
          {leaveStep === 1 ? (
            <div className="stack">
              <p className="notice">
                First confirmation: you are about to leave{" "}
                <strong>{organisation?.name ?? "this organisation"}</strong>. Continue only if
                you intend to remove your own access.
              </p>
              <div className="row">
                <Button variant="secondary" onClick={() => setLeaveStep(2)}>
                  Continue
                </Button>
                <Button
                  variant="tertiary"
                  onClick={() => {
                    setLeaveStep(0);
                    setLeaveError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          {leaveStep === 2 ? (
            <div className="stack">
              <p className="notice notice-danger">
                Second confirmation: leave now? This cannot be undone from your account.
              </p>
              <div className="row">
                <Button
                  variant="secondary"
                  loading={leaving}
                  onClick={() => void confirmLeaveOrganisation()}
                >
                  Yes, leave organisation
                </Button>
                <Button
                  variant="tertiary"
                  disabled={leaving}
                  onClick={() => {
                    setLeaveStep(0);
                    setLeaveError("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

function IntegrationSettings() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHealth()
      .then((payload) => {
        if (!cancelled) {
          setHealth(payload);
          setError("");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth(null);
          setError(
            getClientConfig().dataSource === "api"
              ? "The API is not reachable. Sign-in and organisation data cannot load from MongoDB until it is back."
              : "The API is not reachable. Operational pages still use browser-session fixtures, and integrations are treated as unavailable.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const config = getClientConfig();

  return (
    <div className="stack">
      <p className="notice">
        Server secrets are not shown here. A missing credential is reported as
        unavailable. This screen does not test a provider by calling it.
      </p>
      <p className="muted">
        Frontend data source: {config.dataSource}. API base: {config.apiBaseUrl}
      </p>
      {loading ? <p role="status">Checking integration configuration…</p> : null}
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}
      {health
        ? Object.entries(health.integrations).map(([name, status]) => (
            <article key={name} className="list-card">
              <div className="spread">
                <strong>{name}</strong>
                <StatusBadge
                  status={status.configured ? "info" : "warning"}
                  label={status.configured ? "Configured" : "Unavailable"}
                />
              </div>
              <span className="muted">
                {status.configured
                  ? "Credentials are present on the server. This milestone does not use them."
                  : "Not configured. The application will not pretend this integration succeeded."}
              </span>
            </article>
          ))
        : null}
      {health ? <p className="muted">{health.note}</p> : null}
    </div>
  );
}
