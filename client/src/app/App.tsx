import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui/Toast";
import { AppRouter } from "@/app/router";
import { LiveBootstrap } from "@/hooks/useLiveBootstrap";

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <LiveBootstrap>
          <AppRouter />
        </LiveBootstrap>
      </ToastProvider>
    </BrowserRouter>
  );
}
