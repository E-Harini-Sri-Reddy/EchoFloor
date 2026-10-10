import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { homePathForSession } from "@/domain/access";
import { GoogleSignInButton } from "@/features/auth/GoogleSignInButton";
import { useDemoDatabase } from "@/hooks/useDemo";
import {
  apiGoogleSession,
  apiLogin,
  apiRegister,
} from "@/services/apiClient";
import { demoStore, isLiveDataMode } from "@/services/demoStore";
import { isGoogleOAuthConfigured, type GoogleVerifiedIdentity } from "@/services/googleAuth";
import { isEmail } from "@/utils/format";

type AuthTab = "signin" | "register";

export function EntryPage() {
  const db = useDemoDatabase();
  const navigate = useNavigate();
  const toast = useToast();
  const live = isLiveDataMode();
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
  const [submitting, setSubmitting] = useState<"login" | "register" | null>(null);
  const googleConfigured = isGoogleOAuthConfigured();

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!isEmail(login.email)) errors.email = "Enter the email address.";
    if (!login.password) errors.password = "Enter the password.";
    setLoginErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting("login");

    try {
      if (live) {
        const result = await apiLogin(login.email, login.password);
        if (!result.ok) {
          setLoginErrors(result.fieldErrors ?? { email: result.message });
          return;
        }
        demoStore.hydrateLive(result.data.workspace, result.data.session);
        navigate(homePathForSession(result.data.session));
        return;
      }

      await wait();
      const result = demoStore.loginWithPassword(login.email, login.password);
      if (!result.ok || !result.db.session) {
        if (result.ok) {
          setLoginErrors({ password: "Email or password is incorrect." });
        } else if (result.code === "FORBIDDEN") {
          setLoginErrors({ password: result.message });
        } else {
          const next: Record<string, string> = {};
          if (result.fieldErrors?.email) next.email = result.fieldErrors.email;
          if (result.fieldErrors?.password) next.password = result.fieldErrors.password;
          if (!next.email && !next.password) next.password = result.message;
          setLoginErrors(next);
        }
        return;
      }
      navigate(homePathForSession(result.db.session));
    } finally {
      setSubmitting(null);
    }
  }

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    setSubmitting("register");

    try {
      if (live) {
        const result = await apiRegister({
          organisationName: register.organisationName,
          displayName: register.displayName,
          email: register.email,
          password: register.password,
        });
        if (!result.ok) {
          setRegisterErrors(result.fieldErrors ?? { email: result.message });
          return;
        }
        demoStore.hydrateLive(result.data.workspace, result.data.session);
        toast.push("Organisation created. You are its administrator.");
        navigate("/admin");
        return;
      }

      await wait();
      const result = demoStore.register(register);
      if (!result.ok) {
        setRegisterErrors(result.fieldErrors ?? {});
        return;
      }
      toast.push(
        "Organisation created in this browser session. You are its administrator.",
      );
      navigate("/admin");
    } finally {
      setSubmitting(null);
    }
  }

  async function onGoogleSignInVerified(
    identity: GoogleVerifiedIdentity,
    idToken: string,
  ) {
    setLoginErrors({});
    if (live) {
      setSubmitting("login");
      try {
        const result = await apiGoogleSession(idToken);
        if (!result.ok) {
          setLoginErrors({
            email: result.fieldErrors?.email ?? result.message,
          });
          return;
        }
        demoStore.hydrateLive(result.data.workspace, result.data.session);
        toast.push("Signed in with Google.");
        navigate(homePathForSession(result.data.session));
      } finally {
        setSubmitting(null);
      }
      return;
    }

    const result = demoStore.loginWithGoogle(identity.email);
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

  async function onGoogleRegisterVerified(
    identity: GoogleVerifiedIdentity,
    _idToken: string,
  ) {
    const errors: Record<string, string> = {};
    if (register.organisationName.trim().length < 2) {
      errors.organisationName = "Enter the organisation name before continuing with Google.";
    }
    setRegisterErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (live) {
      setSubmitting("register");
      try {
        const result = await apiRegister({
          organisationName: register.organisationName,
          displayName: register.displayName.trim() || identity.name || identity.email,
          email: identity.email,
          viaGoogle: true,
        });
        if (!result.ok) {
          setRegisterErrors(result.fieldErrors ?? { email: result.message });
          return;
        }
        demoStore.hydrateLive(result.data.workspace, result.data.session);
        toast.push("Organisation created with Google. You are its administrator.");
        navigate("/admin");
      } finally {
        setSubmitting(null);
      }
      return;
    }

    const result = demoStore.registerWithGoogle({
      organisationName: register.organisationName,
      displayName: register.displayName.trim() || identity.name || identity.email,
      email: identity.email,
    });
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
        <p>
          {live
            ? "Signed-in sessions load organisation records from MongoDB."
            : googleConfigured
              ? "Google ID tokens are verified by the EchoFloor API."
              : "Development preview. Set Google OAuth client IDs in .env to enable Google sign-in."}
        </p>
      </section>
      <main className="auth-main">
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
              <GoogleSignInButton
                mode="signin"
                disabled={submitting !== null}
                onVerified={onGoogleSignInVerified}
                onError={(message) => setLoginErrors({ email: message })}
              />
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
                  later with email and a temporary password. For Google sign-up, enter the
                  organisation name first.
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
                hint="Optional when using Google; Google profile name is used if blank."
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
                hint="At least 8 characters for email/password registration. Not needed for Google."
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
              <GoogleSignInButton
                mode="signup"
                disabled={submitting !== null}
                onVerified={onGoogleRegisterVerified}
                onError={(message) => setRegisterErrors({ email: message })}
              />
              <p className="muted">
                Already have an account?{" "}
                <button type="button" className="text-link" onClick={() => setTab("signin")}>
                  Sign in here
                </button>
              </p>
            </form>
          )}
        </div>

        <p className="muted auth-main-foot">
          {live
            ? "Live mode: sign-in loads machines and other records from MongoDB. "
            : `Session records in this tab: ${db.organisations.length} organisations. `}
          <Link to="/access-denied">Preview the access-denied state</Link>.
        </p>
      </main>
    </div>
  );
}

function wait() {
  return new Promise((resolve) => window.setTimeout(resolve, 250));
}
