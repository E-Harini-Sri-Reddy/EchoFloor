import { Outlet, useLocation } from "react-router-dom";
import { PanelTabs } from "@/components/ui/PanelTabs";

export function AdminHomeLayout() {
  const { pathname } = useLocation();
  const activeId = pathname.startsWith("/admin/voice") ? "voice" : "overview";

  return (
    <div className={activeId === "voice" ? "home-panel" : undefined}>
      <PanelTabs
        ariaLabel="Overview and Voice Assistant"
        activeId={activeId}
        tabs={[
          { id: "overview", to: "/admin", label: "Overview" },
          { id: "voice", to: "/admin/voice", label: "Voice Assistant" },
        ]}
      />
      <Outlet />
    </div>
  );
}
