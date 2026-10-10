import { Link } from "react-router-dom";

export interface PanelTab {
  to: string;
  label: string;
  id: string;
}

export function PanelTabs({
  tabs,
  activeId,
  ariaLabel,
}: {
  tabs: PanelTab[];
  activeId: string;
  ariaLabel: string;
}) {
  return (
    <div className="panel-tabs">
      <div className="tabs" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.to}
            role="tab"
            aria-selected={tab.id === activeId}
            className={tab.id === activeId ? "tab is-active" : "tab"}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
