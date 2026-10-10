import { getClientConfig } from "@/services/clientConfig";

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

export interface GoogleVerifiedIdentity {
  provider: "google";
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: "standard" | "icon";
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: number;
              logo_alignment?: "left" | "center";
            },
          ) => void;
          cancel: () => void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

export function getGoogleClientId(): string | null {
  const value = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  return value ? value : null;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(getGoogleClientId());
}

export function loadGoogleIdentityServices(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google sign-in is only available in the browser."));
  }
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Could not load Google Identity Services.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Could not load Google Identity Services."));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleVerifiedIdentity> {
  const { apiBaseUrl } = getClientConfig();
  const response = await fetch(`${apiBaseUrl}/auth/google`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ idToken }),
  });

  const body = (await response.json()) as {
    success: boolean;
    data?: GoogleVerifiedIdentity;
    error?: { code?: string; message?: string };
  };

  if (!response.ok || !body.success || !body.data) {
    throw new Error(
      body.error?.message ??
        "Google sign-in could not be verified. Check that the API is running and GOOGLE_CLIENT_ID is set.",
    );
  }

  return body.data;
}
