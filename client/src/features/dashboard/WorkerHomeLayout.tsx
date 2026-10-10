import { Outlet, useLocation } from "react-router-dom";
import { PanelTabs } from "@/components/ui/PanelTabs";

export function WorkerHomeLayout() {
  const { pathname } = useLocation();
  const activeId = pathname.startsWith("/worker/dashboard") ? "dashboard" : "voice";

  return (
    <div
      className={
        activeId === "voice" ? "home-panel home-panel-narrow" : "home-panel"
      }
    >
      <PanelTabs
        ariaLabel="Voice Assistant and Dashboard"
        activeId={activeId}
        tabs={[
          { id: "voice", to: "/worker/voice", label: "Voice Assistant" },
          { id: "dashboard", to: "/worker/dashboard", label: "Dashboard" },
        ]}
      />
      <Outlet />
    </div>
  );
}
