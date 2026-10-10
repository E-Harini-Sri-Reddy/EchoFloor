import { getClientConfig } from "@/services/clientConfig";
import type { DemoDatabase, Session } from "@/types/domain";

export interface AuthWorkspacePayload {
  session: Session;
  workspace: DemoDatabase;
}

type AuthFail = {
  ok: false;
  message: string;
  fieldErrors?: Record<string, string>;
};

const NETWORK_ERROR: AuthFail = {
  ok: false,
  message:
    "Cannot reach the EchoFloor API. Start the server (npm run dev:server) and try again.",
  fieldErrors: {
    email:
      "Cannot reach the EchoFloor API. Start the server (npm run dev:server) and try again.",
  },
};

async function parseJson(response: Response) {
  return (await response.json()) as {
    success: boolean;
    data?: AuthWorkspacePayload | { workspace: DemoDatabase | null; machineId?: string };
    error?: { code?: string; message?: string; fieldErrors?: Record<string, string> };
  };
}

function authFailure(
  body: Awaited<ReturnType<typeof parseJson>>,
  fallback: string,
): AuthFail {
  const message = body.error?.message ?? fallback;
  return {
    ok: false,
    message,
    fieldErrors: body.error?.fieldErrors ?? { email: message },
  };
}

export async function apiLogin(
  email: string,
  password: string,
): Promise<{ ok: true; data: AuthWorkspacePayload } | AuthFail> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await parseJson(response);
    if (!response.ok || !body.success || !body.data || !("session" in body.data)) {
      return authFailure(body, "Sign-in failed.");
    }
    return { ok: true, data: body.data as AuthWorkspacePayload };
  } catch {
    return NETWORK_ERROR;
  }
}

export async function apiGoogleSession(
  idToken: string,
): Promise<{ ok: true; data: AuthWorkspacePayload } | AuthFail> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/auth/google/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const body = await parseJson(response);
    if (!response.ok || !body.success || !body.data || !("session" in body.data)) {
      return authFailure(body, "Google sign-in failed.");
    }
    return { ok: true, data: body.data as AuthWorkspacePayload };
  } catch {
    return NETWORK_ERROR;
  }
}

export async function apiRegister(input: {
  organisationName: string;
  displayName: string;
  email: string;
  password?: string;
  viaGoogle?: boolean;
}): Promise<{ ok: true; data: AuthWorkspacePayload } | AuthFail> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
    const body = await parseJson(response);
    if (!response.ok || !body.success || !body.data || !("session" in body.data)) {
      return authFailure(body, "Registration failed.");
    }
    return { ok: true, data: body.data as AuthWorkspacePayload };
  } catch {
    return NETWORK_ERROR;
  }
}

export async function apiRefreshWorkspace(
  userId: string,
): Promise<AuthWorkspacePayload | null> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(
      `${apiBaseUrl}/workspace?userId=${encodeURIComponent(userId)}`,
      { headers: { Accept: "application/json" } },
    );
    const body = await parseJson(response);
    if (!response.ok || !body.success || !body.data || !("session" in body.data)) {
      return null;
    }
    return body.data as AuthWorkspacePayload;
  } catch {
    return null;
  }
}

export async function apiCreateMachine(input: {
  organisationId: string;
  createdBy: string;
  machineCode: string;
  name: string;
  description: string;
  productionLine: string;
  area: string;
  machineType: string;
  nfcTagId: string;
}): Promise<DemoDatabase | null> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/machines`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
    const body = await parseJson(response);
    if (!response.ok || !body.success || !body.data || !("workspace" in body.data)) {
      return null;
    }
    return body.data.workspace;
  } catch {
    return null;
  }
}

export async function apiUpdateMachine(
  machineId: string,
  input: {
    organisationId: string;
    updatedBy: string;
    machineCode: string;
    name: string;
    description: string;
    productionLine: string;
    area: string;
    machineType: string;
    nfcTagId: string;
  },
): Promise<DemoDatabase | null> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/machines/${encodeURIComponent(machineId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
    const body = await parseJson(response);
    if (!response.ok || !body.success || !body.data || !("workspace" in body.data)) {
      return null;
    }
    return body.data.workspace;
  } catch {
    return null;
  }
}
