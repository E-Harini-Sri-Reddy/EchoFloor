import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

interface ToastItem {
  id: number;
  message: string;
  to?: string;
}

interface ToastOptions {
  to?: string;
}

interface ToastApi {
  push: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const navigate = useNavigate();

  const push = useCallback((message: string, options?: ToastOptions) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, to: options?.to }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) =>
          toast.to ? (
            <button
              key={toast.id}
              type="button"
              className="toast toast-link"
              onClick={() => {
                navigate(toast.to!);
                setToasts((current) => current.filter((item) => item.id !== toast.id));
              }}
            >
              <span>{toast.message}</span>
              <span className="toast-action">Open</span>
            </button>
          ) : (
            <div className="toast" key={toast.id} role="status">
              {toast.message}
            </div>
          ),
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider.");
  }
  return context;
}
