import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export function LoadingState({
  label = "Loading operational records…",
}: {
  label?: string;
}) {
  return (
    <div className="page" role="status" aria-live="polite">
      <p>{label}</p>
      <div className="metric-grid" aria-hidden="true">
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
        <div className="skeleton" />
      </div>
      <div className="skeleton" />
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="card stack">
      <h3>{title}</h3>
      <p className="muted">{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "The records could not be loaded",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="page">
      <div className="notice notice-danger" role="alert">
        <h2>{title}</h2>
        <p>{message}</p>
        {onRetry ? (
          <div className="row" style={{ marginTop: 12 }}>
            <Button onClick={onRetry}>Try again</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
