import { Navigate, Outlet, useLocation } from "react-router-dom";
import { PanelTabs } from "@/components/ui/PanelTabs";

export function WorkerIssuesLayout() {
  const { pathname } = useLocation();
  const activeId = pathname.includes("/report") ? "report" : "alerts";

  return (
    <>
      <PanelTabs
        ariaLabel="Report Issue and Live Alerts"
        activeId={activeId}
        tabs={[
          { id: "report", to: "/worker/issues/report", label: "Report Issue" },
          { id: "alerts", to: "/worker/issues/alerts", label: "Live Alerts" },
        ]}
      />
      <Outlet />
    </>
  );
}

export function WorkerIssuesIndex() {
  return <Navigate to="/worker/issues/alerts" replace />;
}
