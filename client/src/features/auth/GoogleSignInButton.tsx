import { useEffect, useRef, useState } from "react";
import {
  getGoogleClientId,
  isGoogleOAuthConfigured,
  loadGoogleIdentityServices,
  verifyGoogleIdToken,
  type GoogleVerifiedIdentity,
} from "@/services/googleAuth";

interface GoogleSignInButtonProps {
  mode: "signin" | "signup";
  disabled?: boolean;
  onVerified: (
    identity: GoogleVerifiedIdentity,
    idToken: string,
  ) => void | Promise<void>;
  onError: (message: string) => void;
}

export function GoogleSignInButton({
  mode,
  disabled = false,
  onVerified,
  onError,
}: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const handlersRef = useRef({ onVerified, onError });
  handlersRef.current = { onVerified, onError };

  useEffect(() => {
    if (!isGoogleOAuthConfigured()) return;
    let cancelled = false;
    const clientId = getGoogleClientId();
    if (!clientId) return;

    void loadGoogleIdentityServices()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google?.accounts?.id) return;
        containerRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            void (async () => {
              setBusy(true);
              try {
                const identity = await verifyGoogleIdToken(response.credential);
                await handlersRef.current.onVerified(identity, response.credential);
              } catch (error) {
                handlersRef.current.onError(
                  error instanceof Error
                    ? error.message
                    : "Google sign-in failed.",
                );
              } finally {
                setBusy(false);
              }
            })();
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: mode === "signup" ? "signup_with" : "signin_with",
          shape: "rectangular",
          width: 360,
          logo_alignment: "left",
        });
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          handlersRef.current.onError(
            error instanceof Error
              ? error.message
              : "Google Identity Services could not be loaded.",
          );
        }
      });

    return () => {
      cancelled = true;
      window.google?.accounts.id.cancel();
    };
  }, [mode]);

  if (!isGoogleOAuthConfigured()) {
    return (
      <p className="muted">
        Google sign-in is unavailable until{" "}
        <span className="mono">VITE_GOOGLE_CLIENT_ID</span> and{" "}
        <span className="mono">GOOGLE_CLIENT_ID</span> are set in{" "}
        <span className="mono">.env</span>, and the API is restarted.
      </p>
    );
  }

  return (
    <div className="google-signin" aria-busy={busy || !ready || disabled}>
      <div
        ref={containerRef}
        className={disabled || busy ? "google-signin-host is-disabled" : "google-signin-host"}
      />
      {busy ? <p className="muted">Verifying Google account…</p> : null}
    </div>
  );
}
