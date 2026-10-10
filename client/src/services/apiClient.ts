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
    data?:
      | AuthWorkspacePayload
      | {
          workspace: DemoDatabase | null;
          machineId?: string;
          alertId?: string;
          memoryId?: string;
          session?: Session;
        };
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

export async function apiAddMember(input: {
  organisationId: string;
  addedBy: string;
  email: string;
  temporaryPassword: string;
  workerAccessType: "permanent" | "temporary";
  accessDuration: string;
  customExpiresAt?: string;
}): Promise<{ ok: true; data: AuthWorkspacePayload } | AuthFail> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
    const body = await parseJson(response);
    if (!response.ok || !body.success || !body.data || !("session" in body.data)) {
      return authFailure(body, "Could not add the member.");
    }
    return { ok: true, data: body.data as AuthWorkspacePayload };
  } catch {
    return NETWORK_ERROR;
  }
}

export async function apiLeaveOrganisation(input: {
  userId: string;
  organisationId: string;
  confirm: boolean;
}): Promise<{ ok: true } | AuthFail> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/memberships/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
    const body = await parseJson(response);
    if (!response.ok || !body.success) {
      return authFailure(body, "Could not leave the organisation.");
    }
    return { ok: true };
  } catch {
    return NETWORK_ERROR;
  }
}

export async function apiRemoveMember(input: {
  membershipId: string;
  organisationId: string;
  removedBy: string;
  confirm: boolean;
}): Promise<{ ok: true; data: AuthWorkspacePayload } | AuthFail> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/memberships/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
    const body = await parseJson(response);
    if (!response.ok || !body.success || !body.data || !("session" in body.data)) {
      return authFailure(body, "Could not remove the member.");
    }
    return { ok: true, data: body.data as AuthWorkspacePayload };
  } catch {
    return NETWORK_ERROR;
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

export async function apiReportMachineIssue(input: {
  organisationId: string;
  reportedBy: string;
  machineId: string;
  issueKind: string;
  title: string;
  description: string;
  expiresAt: string;
  photoDataUrl: string;
  photoName: string;
  photoBytes: number;
  photoSource: "camera" | "upload";
}): Promise<{ ok: true; data: AuthWorkspacePayload } | AuthFail> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
    const body = await parseJson(response);
    if (
      !response.ok ||
      !body.success ||
      !body.data ||
      !("workspace" in body.data) ||
      !body.data.workspace
    ) {
      return {
        ok: false,
        message: body.error?.message ?? "Could not save the issue to the database.",
        fieldErrors: body.error?.fieldErrors,
      };
    }
    const workspace = body.data.workspace;
    const session =
      "session" in body.data && body.data.session
        ? (body.data.session as Session)
        : null;
    if (!session) {
      return {
        ok: false,
        message: "Issue saved but the workspace session could not be refreshed.",
      };
    }
    return { ok: true, data: { workspace, session } };
  } catch {
    return NETWORK_ERROR;
  }
}
