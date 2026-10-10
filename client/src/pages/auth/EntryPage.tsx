import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { homePathForSession } from "@/domain/access";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/fixtures/seed";
import { useDemoDatabase } from "@/hooks/useDemo";
import { demoStore } from "@/services/demoStore";
import { isEmail } from "@/utils/format";

type AuthTab = "signin" | "register";

export function EntryPage() {
  const db = useDemoDatabase();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<AuthTab>("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [loginErrors, setLoginErrors] = useState<Record<string, string>>({});
  const [register, setRegister] = useState({
    organisationName: "",
    displayName: "",
    email: "",
    password: "",
  });
  const [registerErrors, setRegisterErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<
    "login" | "register" | "google-login" | "google-register" | null
  >(null);

  function enter(email: string) {
    const result = demoStore.login(email);
    if (!result.ok || !result.db.session) {
      toast.push(result.ok ? "Sign-in failed." : result.message);
      return;
    }
    navigate(homePathForSession(result.db.session));
  }

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!isEmail(login.email)) errors.email = "Enter the email address.";
    if (!login.password) errors.password = "Enter the password.";
    setLoginErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting("login");
    await wait();
    const result = demoStore.loginWithPassword(login.email, login.password);
    setSubmitting(null);
    if (!result.ok || !result.db.session) {
      setLoginErrors({
        password: result.ok
          ? "Email or password is incorrect."
          : result.code === "FORBIDDEN"
            ? result.message
            : (result.fieldErrors?.password ?? result.message),
      });
      return;
    }
    navigate(homePathForSession(result.db.session));
  }

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    setSubmitting("register");
    await wait();
    const result = demoStore.register(register);
    setSubmitting(null);
    if (!result.ok) {
      setRegisterErrors(result.fieldErrors ?? {});
      return;
    }
    toast.push(
      "Organisation created in this browser session. You are its administrator.",
    );
    navigate("/admin");
  }

  async function onGoogleSignIn() {
    const email = login.email.trim();
    if (!isEmail(email)) {
      setLoginErrors({
        email: "Enter the Google account email first (preview stand-in for OAuth).",
      });
      return;
    }
    setSubmitting("google-login");
    await wait();
    const result = demoStore.loginWithGoogle(email);
    setSubmitting(null);
    if (!result.ok || !result.db.session) {
      setLoginErrors({
        email: result.ok
          ? "Sign-in failed."
          : (result.fieldErrors?.email ?? result.message),
      });
      return;
    }
    toast.push("Signed in with Google. Same user id as email/password for that account.");
    navigate(homePathForSession(result.db.session));
  }

  async function onGoogleRegister() {
    const errors: Record<string, string> = {};
    if (register.organisationName.trim().length < 2) {
      errors.organisationName = "Enter the organisation name.";
    }
    if (register.displayName.trim().length < 2) {
      errors.displayName = "Enter your name.";
    }
    if (!isEmail(register.email)) {
      errors.email = "Enter the Google account email.";
    }
    setRegisterErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting("google-register");
    await wait();
    const result = demoStore.registerWithGoogle({
      organisationName: register.organisationName,
      displayName: register.displayName,
      email: register.email,
    });
    setSubmitting(null);
    if (!result.ok) {
      setRegisterErrors(result.fieldErrors ?? {});
      return;
    }
    toast.push("Organisation created with Google. You are its administrator.");
    navigate("/admin");
  }

  return (
    <div className="auth-screen">
      <section className="auth-panel">
        <div className="stack">
          <div className="brand">
            <span className="brand-mark">EF</span>
            <div>
              <strong>EchoFloor</strong>
              <span>Agentic memory for the factory floor</span>
            </div>
          </div>
          <h1>Your floor. Shared memory.</h1>
          <p>
            Track machine reports, handovers, and AI-assisted answers without controlling
            equipment or reading live sensors.
          </p>
          <ul className="auth-feature-list">
            <li>Voice and text operational memory</li>
            <li>Administrator and worker access</li>
            <li>Permanent or time-bounded workers</li>
            <li>Email/password or Google, one user id</li>
          </ul>
        </div>
        <p>Development preview. Authentication is not connected to a server.</p>
      </section>
      <main className="auth-main">
        <div className="notice">
          <strong>Development-only entry.</strong>
          <p>
            Northstar Manufacturing example password:{" "}
            <span className="mono">{DEMO_PASSWORD}</span>. Invited workers use the
            temporary password set by an administrator. Google sign-in is mocked: enter the
            account email, then continue.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            {DEMO_ACCOUNTS.map((account) => (
              <Button
                key={account.email}
                variant="secondary"
                onClick={() => enter(account.email)}
              >
                Preview as {account.roleLabel}: {account.name}
              </Button>
            ))}
            <Button
              variant="tertiary"
              onClick={() => {
                demoStore.reset();
                toast.push("Example records were reset in this browser session.");
              }}
            >
              Reset example data
            </Button>
          </div>
        </div>

        <div className="auth-card card">
          <div className="auth-tabs" role="tablist" aria-label="Authentication">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "signin"}
              className={tab === "signin" ? "auth-tab is-active" : "auth-tab"}
              onClick={() => setTab("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "register"}
              className={tab === "register" ? "auth-tab is-active" : "auth-tab"}
              onClick={() => setTab("register")}
            >
              Register
            </button>
          </div>

          {tab === "signin" ? (
            <form className="form-grid" onSubmit={onLogin} noValidate>
              <div>
                <h2>Welcome back</h2>
                <p className="muted">Sign in with email and password or Google.</p>
              </div>
              <Field label="Email" htmlFor="login-email" error={loginErrors.email}>
                <TextInput
                  id="login-email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  value={login.email}
                  error={loginErrors.email}
                  onChange={(event) => setLogin({ ...login, email: event.target.value })}
                />
              </Field>
              <Field label="Password" htmlFor="login-password" error={loginErrors.password}>
                <div className="password-field">
                  <TextInput
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={login.password}
                    error={loginErrors.password}
                    onChange={(event) =>
                      setLogin({ ...login, password: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </Field>
              <Button type="submit" loading={submitting === "login"}>
                Sign in
              </Button>
              <div className="auth-divider" role="separator">
                <span>or</span>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="btn-google"
                loading={submitting === "google-login"}
                onClick={onGoogleSignIn}
              >
                Sign in with Google
              </Button>
              <p className="muted">
                Don&apos;t have an organisation?{" "}
                <button type="button" className="text-link" onClick={() => setTab("register")}>
                  Register here
                </button>
              </p>
            </form>
          ) : (
            <form className="form-grid" onSubmit={onRegister} noValidate>
              <div>
                <h2>Create an organisation</h2>
                <p className="muted">
                  The person who registers becomes the administrator. Workers are invited
                  later with email and a temporary password.
                </p>
              </div>
              <Field
                label="Organisation name"
                htmlFor="org-name"
                error={registerErrors.organisationName}
              >
                <TextInput
                  id="org-name"
                  placeholder="e.g. Northstar Manufacturing"
                  value={register.organisationName}
                  error={registerErrors.organisationName}
                  onChange={(event) =>
                    setRegister({ ...register, organisationName: event.target.value })
                  }
                />
              </Field>
              <Field
                label="Your name"
                htmlFor="admin-name"
                error={registerErrors.displayName}
              >
                <TextInput
                  id="admin-name"
                  placeholder="Your name"
                  value={register.displayName}
                  error={registerErrors.displayName}
                  onChange={(event) =>
                    setRegister({ ...register, displayName: event.target.value })
                  }
                />
              </Field>
              <Field label="Email" htmlFor="admin-email" error={registerErrors.email}>
                <TextInput
                  id="admin-email"
                  type="email"
                  placeholder="you@example.com"
                  value={register.email}
                  error={registerErrors.email}
                  onChange={(event) =>
                    setRegister({ ...register, email: event.target.value })
                  }
                />
              </Field>
              <Field
                label="Password"
                htmlFor="admin-password"
                error={registerErrors.password}
                hint="At least 8 characters. Stored only in this browser session."
              >
                <div className="password-field">
                  <TextInput
                    id="admin-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={register.password}
                    error={registerErrors.password}
                    onChange={(event) =>
                      setRegister({ ...register, password: event.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </Field>
              <Button type="submit" loading={submitting === "register"}>
                Create organisation
              </Button>
              <div className="auth-divider" role="separator">
                <span>or</span>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="btn-google"
                loading={submitting === "google-register"}
                onClick={onGoogleRegister}
              >
                Sign up with Google
              </Button>
              <p className="muted">
                Already have an account?{" "}
                <button type="button" className="text-link" onClick={() => setTab("signin")}>
                  Sign in here
                </button>
              </p>
            </form>
          )}
        </div>

        <p className="muted">
          Session records in this tab: {db.organisations.length} organisations.{" "}
          <Link to="/access-denied">Preview the access-denied state</Link>.
        </p>
      </main>
    </div>
  );
}

function wait() {
  return new Promise((resolve) => window.setTimeout(resolve, 250));
}
