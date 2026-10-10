import { useEffect, useState, type ReactNode } from "react";
import { LoadingState } from "@/components/ui/States";
import { apiRefreshWorkspace } from "@/services/apiClient";
import { demoStore, getDatabase, isLiveDataMode } from "@/services/demoStore";

/**
 * When VITE_DATA_SOURCE=api, refresh a persisted live session from MongoDB
 * before rendering protected routes.
 */
export function LiveBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => !isLiveDataMode());

  useEffect(() => {
    if (!isLiveDataMode()) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const db = getDatabase();
    const userId = db.session?.live ? db.session.userId : null;
    if (!userId) {
      setReady(true);
      return;
    }
    void apiRefreshWorkspace(userId)
      .then((payload) => {
        if (cancelled) return;
        if (payload) {
          demoStore.hydrateLive(payload.workspace, payload.session);
        } else {
          demoStore.logout();
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <LoadingState label="Loading organisation data from the database…" />;
  }
  return children;
}
