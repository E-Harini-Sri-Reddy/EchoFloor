import { Link } from "react-router-dom";
import { homePathForSession, isTemporaryWorker } from "@/domain/access";
import { useDemoDatabase } from "@/hooks/useDemo";

export function AccessDeniedPage() {
  const session = useDemoDatabase().session;
  const home = session ? homePathForSession(session) : "/";
  const temporary = isTemporaryWorker(session);
  return (
    <main className="page">
      <div className="notice notice-danger" role="alert">
        <h1>Access denied</h1>
        <p>
          {temporary
            ? "Temporary workers can use Voice with an overall usage summary, Report Issue with a photo, Live Alerts, Tasks, and History for damage and repair logs. They cannot open detailed daily work logs, My Shift, Memory Explorer, or full machine operational memory."
            : "This area is not available for the current role. Workers cannot open Memory Explorer or edit existing memories. Temporary workers have a narrower workspace than permanent workers."}
        </p>
        <p>
          Frontend checks are only a guide — the API must enforce the same rule when it
          is connected.
        </p>
        <p style={{ marginTop: 12 }}>
          <Link to={home}>Return to your workspace</Link>
        </p>
      </div>
    </main>
  );
}
