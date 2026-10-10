export interface ClientConfig {
  appName: string;
  apiBaseUrl: string;
  dataSource: "mock" | "api";
  googleClientId: string | null;
}

export function getClientConfig(): ClientConfig {
  const dataSource = import.meta.env.VITE_DATA_SOURCE === "api" ? "api" : "mock";
  // Relative /api/v1 is used on Render (same-origin). Absolute URL for local Vite.
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:5000/api/v1";
  const appName = import.meta.env.VITE_APP_NAME?.trim() || "EchoFloor";
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || null;
  return { appName, apiBaseUrl, dataSource, googleClientId };
}

export interface HealthPayload {
  status: string;
  dataApi: string;
  note: string;
  integrations: Record<
    string,
    { configured: boolean; status: "configured" | "unavailable" }
  >;
}

export async function fetchHealth(): Promise<HealthPayload> {
  const { apiBaseUrl } = getClientConfig();
  const response = await fetch(`${apiBaseUrl}/health`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("The API health check failed.");
  }
  const body = (await response.json()) as { success: boolean; data?: HealthPayload };
  if (!body.success || !body.data) {
    throw new Error("The API health check returned an unexpected response.");
  }
  return body.data;
}
