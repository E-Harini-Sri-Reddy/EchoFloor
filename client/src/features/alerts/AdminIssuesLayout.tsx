import { Navigate, Outlet, useLocation } from "react-router-dom";
import { PanelTabs } from "@/components/ui/PanelTabs";

export function AdminIssuesLayout() {
  const { pathname } = useLocation();
  const activeId = pathname.includes("/report") ? "report" : "alerts";

  return (
    <>
      <PanelTabs
        ariaLabel="Report Issue and Live Alerts"
        activeId={activeId}
        tabs={[
          { id: "report", to: "/admin/issues/report", label: "Report Issue" },
          { id: "alerts", to: "/admin/issues/alerts", label: "Live Alerts" },
        ]}
      />
      <Outlet />
    </>
  );
}

export function AdminIssuesIndex() {
  return <Navigate to="/admin/issues/alerts" replace />;
}
