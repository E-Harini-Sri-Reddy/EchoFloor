import { BrowserRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui/Toast";
import { AppRouter } from "@/app/router";

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppRouter />
      </ToastProvider>
    </BrowserRouter>
  );
}
