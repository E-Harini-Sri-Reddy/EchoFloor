import { getClientConfig } from "@/services/clientConfig";
import type { Severity } from "@/types/domain";

export interface LiveSessionIds {
  userId: string;
  organisationId: string;
}

export interface VoiceEvidenceItem {
  recordId: string;
  text: string;
  createdAt: string;
  machineId: string;
}

export interface VoiceQuestionResult {
  requestId: string;
  answer: string;
  evidence: VoiceEvidenceItem[];
}

export interface VoiceReportPollResult {
  requestId: string;
  status: "pending" | "completed" | "failed";
  result: Record<string, unknown> | null;
  errorMessage: string | null;
}

export interface HandoverPollResult {
  requestId: string;
  status: "pending" | "completed" | "failed";
  result: Record<string, unknown> | null;
  handover: {
    id: string;
    summaryMarkdown: string;
    memoryIds: string[];
    generatedAt: string | null;
  } | null;
  errorMessage: string | null;
}

export interface N8nAlertItem {
  id: string;
  eventId?: string;
  organisationId: string;
  machineId?: string;
  severity: Severity;
  title: string;
  message: string;
  read: boolean;
  type: string;
  status: string;
  sourceType: string;
  createdAt: string;
}

type ApiBody<T> = {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
};

function sessionHeaders(session: LiveSessionIds): HeadersInit {
  return {
    Accept: "application/json",
    "X-EchoFloor-User-Id": session.userId,
    "X-EchoFloor-Organisation-Id": session.organisationId,
  };
}

async function parseBody<T>(response: Response): Promise<{ status: number; body: ApiBody<T> }> {
  const body = (await response.json()) as ApiBody<T>;
  return { status: response.status, body };
}

export async function resolveOverheatingByVoiceApi(
  session: LiveSessionIds,
  machineId: string,
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/voice/resolve-overheating`, {
      method: "POST",
      headers: {
        ...sessionHeaders(session),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        machineId,
        userId: session.userId,
        organisationId: session.organisationId,
      }),
    });
    const { body } = await parseBody<{ message: string }>(response);
    if (!response.ok || !body.success || !body.data?.message) {
      return {
        ok: false,
        message: body.error?.message ?? "Could not update the overheating record.",
      };
    }
    return { ok: true, message: body.data.message };
  } catch {
    return { ok: false, message: "Cannot reach the EchoFloor API." };
  }
}

export async function postVoiceQuestion(
  session: LiveSessionIds,
  input: { machineId: string; audioBlob: Blob; filename?: string },
): Promise<
  | { ok: true; pending: true; requestId: string }
  | { ok: true; pending: false; data: VoiceQuestionResult }
  | { ok: false; message: string }
> {
  const { apiBaseUrl } = getClientConfig();
  const form = new FormData();
  form.append("machineId", input.machineId);
  form.append("userId", session.userId);
  form.append("organisationId", session.organisationId);
  const name = input.filename ?? "question.webm";
  form.append("audioFile", input.audioBlob, name);

  try {
    const response = await fetch(`${apiBaseUrl}/voice/questions`, {
      method: "POST",
      headers: sessionHeaders(session),
      body: form,
    });
    const { status, body } = await parseBody<
      VoiceQuestionResult | { requestId: string; status: string }
    >(response);
    if (!body.success) {
      return { ok: false, message: body.error?.message ?? "Voice question failed." };
    }
    if (status === 202 && body.data && "requestId" in body.data) {
      return { ok: true, pending: true, requestId: body.data.requestId };
    }
    if (body.data && "answer" in body.data) {
      return { ok: true, pending: false, data: body.data };
    }
    return { ok: false, message: "Unexpected voice question response." };
  } catch {
    return { ok: false, message: "Cannot reach the EchoFloor API." };
  }
}

export async function getVoiceQuestion(
  session: LiveSessionIds,
  requestId: string,
): Promise<
  | { ok: true; pending: true }
  | { ok: true; pending: false; data: VoiceQuestionResult }
  | { ok: false; message: string }
> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(
      `${apiBaseUrl}/voice/questions/${encodeURIComponent(requestId)}`,
      { headers: sessionHeaders(session) },
    );
    const { status, body } = await parseBody<VoiceQuestionResult | { requestId: string; status: string }>(
      response,
    );
    if (!body.success) {
      return { ok: false, message: body.error?.message ?? "Could not load the voice answer." };
    }
    if (status === 202) return { ok: true, pending: true };
    if (body.data && "answer" in body.data) {
      return { ok: true, pending: false, data: body.data };
    }
    return { ok: false, message: "Unexpected poll response." };
  } catch {
    return { ok: false, message: "Cannot reach the EchoFloor API." };
  }
}

export async function pollVoiceQuestion(
  session: LiveSessionIds,
  requestId: string,
  options?: { intervalMs?: number; maxAttempts?: number; maxWaitMs?: number },
): Promise<
  | { ok: true; data: VoiceQuestionResult }
  | { ok: false; message: string; timedOut?: boolean }
> {
  const intervalMs = options?.intervalMs ?? 1500;
  const maxWaitMs =
    options?.maxWaitMs ??
    (options?.maxAttempts !== undefined
      ? options.maxAttempts * intervalMs
      : 30_000);
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await getVoiceQuestion(session, requestId);
    if (!result.ok) return result;
    if (!result.pending) return { ok: true, data: result.data };
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) =>
      window.setTimeout(resolve, Math.min(intervalMs, remaining)),
    );
  }
  return {
    ok: false,
    timedOut: true,
    message: "Voice answer timed out while waiting for n8n.",
  };
}

export async function postVoiceReport(
  session: LiveSessionIds,
  input: { machineId: string; audioBlob: Blob; filename?: string },
): Promise<{ ok: true; requestId: string } | { ok: false; message: string }> {
  const { apiBaseUrl } = getClientConfig();
  const form = new FormData();
  form.append("machineId", input.machineId);
  form.append("userId", session.userId);
  form.append("organisationId", session.organisationId);
  const name = input.filename ?? "report.webm";
  form.append("audioFile", input.audioBlob, name);

  try {
    const response = await fetch(`${apiBaseUrl}/reports/voice`, {
      method: "POST",
      headers: sessionHeaders(session),
      body: form,
    });
    const { body } = await parseBody<{ requestId: string }>(response);
    if (!response.ok || !body.success || !body.data?.requestId) {
      return { ok: false, message: body.error?.message ?? "Voice report failed." };
    }
    return { ok: true, requestId: body.data.requestId };
  } catch {
    return { ok: false, message: "Cannot reach the EchoFloor API." };
  }
}

export async function getVoiceReport(
  session: LiveSessionIds,
  requestId: string,
): Promise<{ ok: true; data: VoiceReportPollResult } | { ok: false; message: string }> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(
      `${apiBaseUrl}/reports/voice/${encodeURIComponent(requestId)}`,
      { headers: sessionHeaders(session) },
    );
    const { body } = await parseBody<VoiceReportPollResult>(response);
    if (!body.success || !body.data) {
      return { ok: false, message: body.error?.message ?? "Could not load report status." };
    }
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, message: "Cannot reach the EchoFloor API." };
  }
}

export async function pollVoiceReport(
  session: LiveSessionIds,
  requestId: string,
  options?: { intervalMs?: number; maxAttempts?: number },
): Promise<{ ok: true; data: VoiceReportPollResult } | { ok: false; message: string }> {
  const intervalMs = options?.intervalMs ?? 1500;
  const maxAttempts = options?.maxAttempts ?? 60;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await getVoiceReport(session, requestId);
    if (!result.ok) return result;
    if (result.data.status !== "pending") return result;
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
  return { ok: false, message: "Voice report timed out while waiting for n8n." };
}

export async function postShiftHandover(
  session: LiveSessionIds,
  shiftId: string,
): Promise<{ ok: true; requestId: string } | { ok: false; message: string }> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(
      `${apiBaseUrl}/shifts/${encodeURIComponent(shiftId)}/handover`,
      {
        method: "POST",
        headers: {
          ...sessionHeaders(session),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: session.userId,
          organisationId: session.organisationId,
        }),
      },
    );
    const { body } = await parseBody<{ requestId: string }>(response);
    if (!response.ok || !body.success || !body.data?.requestId) {
      return { ok: false, message: body.error?.message ?? "Handover request failed." };
    }
    return { ok: true, requestId: body.data.requestId };
  } catch {
    return { ok: false, message: "Cannot reach the EchoFloor API." };
  }
}

export async function getHandoverRequest(
  session: LiveSessionIds,
  requestId: string,
): Promise<{ ok: true; data: HandoverPollResult } | { ok: false; message: string }> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(
      `${apiBaseUrl}/handovers/${encodeURIComponent(requestId)}`,
      { headers: sessionHeaders(session) },
    );
    const { body } = await parseBody<HandoverPollResult>(response);
    if (!body.success || !body.data) {
      return { ok: false, message: body.error?.message ?? "Could not load handover status." };
    }
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, message: "Cannot reach the EchoFloor API." };
  }
}

export async function pollHandoverRequest(
  session: LiveSessionIds,
  requestId: string,
  options?: { intervalMs?: number; maxAttempts?: number },
): Promise<{ ok: true; data: HandoverPollResult } | { ok: false; message: string }> {
  const intervalMs = options?.intervalMs ?? 2000;
  const maxAttempts = options?.maxAttempts ?? 45;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const result = await getHandoverRequest(session, requestId);
    if (!result.ok) return result;
    if (result.data.status !== "pending") return result;
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
  return { ok: false, message: "Handover generation timed out while waiting for n8n." };
}

export async function fetchN8nAlerts(
  session: LiveSessionIds,
): Promise<
  | { ok: true; alerts: N8nAlertItem[]; unreadCount: number }
  | { ok: false; message: string }
> {
  const { apiBaseUrl } = getClientConfig();
  const url = `${apiBaseUrl}/alerts?userId=${encodeURIComponent(session.userId)}&organisationId=${encodeURIComponent(session.organisationId)}`;
  try {
    const response = await fetch(url, { headers: sessionHeaders(session) });
    const { body } = await parseBody<{ alerts: N8nAlertItem[]; unreadCount: number }>(response);
    if (!response.ok || !body.success || !body.data) {
      return { ok: false, message: body.error?.message ?? "Could not load alerts." };
    }
    return { ok: true, alerts: body.data.alerts, unreadCount: body.data.unreadCount };
  } catch {
    return { ok: false, message: "Cannot reach the EchoFloor API." };
  }
}

export async function markN8nAlertRead(
  session: LiveSessionIds,
  alertId: string,
): Promise<{ ok: true; alert: N8nAlertItem } | { ok: false; message: string }> {
  const { apiBaseUrl } = getClientConfig();
  try {
    const response = await fetch(`${apiBaseUrl}/alerts/${encodeURIComponent(alertId)}/read`, {
      method: "PATCH",
      headers: {
        ...sessionHeaders(session),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: session.userId,
        organisationId: session.organisationId,
      }),
    });
    const { body } = await parseBody<N8nAlertItem>(response);
    if (!response.ok || !body.success || !body.data) {
      return { ok: false, message: body.error?.message ?? "Could not mark alert read." };
    }
    return { ok: true, alert: body.data };
  } catch {
    return { ok: false, message: "Cannot reach the EchoFloor API." };
  }
}
