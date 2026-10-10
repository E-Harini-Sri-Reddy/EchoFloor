import { useCallback, useEffect, useState } from "react";
import { labelSeverity } from "@/domain/labels";
import { useDemoDatabase } from "@/hooks/useDemo";
import {
  fetchN8nAlerts,
  markN8nAlertRead,
  type N8nAlertItem,
} from "@/services/n8nApi";
import { formatTimestamp } from "@/utils/format";

const POLL_MS = 30_000;

export function AlertBell() {
  const db = useDemoDatabase();
  const session = db.session;
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<N8nAlertItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const timezone =
    db.organisations.find((item) => item.id === session?.organisationId)?.settings
      .timezone ?? "UTC";

  const refresh = useCallback(async () => {
    if (!session?.live) return;
    setLoading(true);
    const result = await fetchN8nAlerts({
      userId: session.userId,
      organisationId: session.organisationId,
    });
    setLoading(false);
    if (result.ok) {
      setAlerts(result.alerts);
      setUnreadCount(result.unreadCount);
    }
  }, [session?.live, session?.userId, session?.organisationId]);

  useEffect(() => {
    if (!session?.live) return;
    void refresh();
    const handle = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(handle);
  }, [session?.live, refresh]);

  if (!session?.live) return null;

  async function markRead(alert: N8nAlertItem) {
    if (alert.read) return;
    const result = await markN8nAlertRead(
      { userId: session!.userId, organisationId: session!.organisationId },
      alert.id,
    );
    if (result.ok) {
      setAlerts((current) =>
        current.map((item) => (item.id === alert.id ? result.alert : item)),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
    }
  }

  return (
    <div className="notify n8n-alert-bell">
      <button
        type="button"
        className="icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${unreadCount} n8n workflow alerts`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⚡</span>
        {unreadCount > 0 ? <span className="alert-count">{unreadCount}</span> : null}
      </button>
      {open ? (
        <div className="notify-menu" role="menu" aria-label="n8n workflow alerts">
          <div className="notify-menu-head">
            <strong>Workflow alerts</strong>
            <span className="muted">
              {loading ? "Updating…" : `${unreadCount} unread`}
            </span>
          </div>
          {alerts.length === 0 ? (
            <p className="muted notify-empty">No n8n workflow alerts for this organisation.</p>
          ) : (
            <ul className="notify-list">
              {alerts.map((alert) => (
                <li key={alert.id}>
                  <button
                    type="button"
                    className="notify-item"
                    role="menuitem"
                    onClick={() => void markRead(alert)}
                  >
                    <div className="spread">
                      <strong>{alert.title}</strong>
                      <span className="muted">{labelSeverity(alert.severity)}</span>
                    </div>
                    <span className="muted">{alert.message}</span>
                    <span className="muted">
                      {formatTimestamp(alert.createdAt, timezone)}
                      {alert.read ? " · Read" : " · Mark read"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
