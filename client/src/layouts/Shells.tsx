import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  homePathForSession,
  isTemporaryWorker,
  membershipAccessState,
  membershipAllowsLogin,
} from "@/domain/access";
import { labelSessionRole } from "@/domain/labels";
import {
  countNotifications,
  notificationsForSession,
} from "@/domain/notifications";
import { useDemoDatabase } from "@/hooks/useDemo";
import { demoStore } from "@/services/demoStore";
import { AlertBell } from "@/components/alerts/AlertBell";
import { ErrorState, LoadingState } from "@/components/ui/States";

interface NavItem {
  to: string;
  label: string;
  short: string;
  end?: boolean;
  /** When set, used instead of default prefix matching for active state. */
  isActive?: (pathname: string) => boolean;
}

const adminNav: NavItem[] = [
  {
    to: "/admin",
    label: "Overview & Voice",
    short: "Home",
    isActive: (pathname) => pathname === "/admin" || pathname === "/admin/voice",
  },
  { to: "/admin/machines", label: "Machine Details", short: "Machines" },
  { to: "/admin/tasks", label: "Tasks", short: "Tasks" },
  {
    to: "/admin/issues",
    label: "Issues & Alerts",
    short: "Issues",
    isActive: (pathname) =>
      pathname.startsWith("/admin/issues") ||
      pathname === "/admin/report-issue" ||
      pathname.startsWith("/admin/alerts"),
  },
  { to: "/admin/memories", label: "Memory Explorer", short: "Memory" },
  { to: "/admin/handover", label: "Shifts & Handovers", short: "Shifts" },
  { to: "/admin/users", label: "Users", short: "Users" },
  { to: "/admin/settings", label: "Settings", short: "Settings" },
];

const permanentWorkerNav: NavItem[] = [
  {
    to: "/worker/voice",
    label: "Voice & Dashboard",
    short: "Home",
    isActive: (pathname) =>
      pathname === "/worker" ||
      pathname === "/worker/voice" ||
      pathname === "/worker/dashboard",
  },
  { to: "/worker/work-log", label: "Work log", short: "Work" },
  { to: "/worker/machines", label: "Machine Details", short: "Machines" },
  { to: "/worker/tasks", label: "My Tasks", short: "Tasks" },
  {
    to: "/worker/issues",
    label: "Issues & Alerts",
    short: "Issues",
    isActive: (pathname) =>
      pathname.startsWith("/worker/issues") ||
      pathname === "/worker/report-issue" ||
      pathname.startsWith("/worker/alerts"),
  },
  { to: "/worker/shift", label: "My Shift", short: "My Shift" },
  { to: "/worker/settings", label: "Settings", short: "Settings" },
];

const temporaryWorkerNav: NavItem[] = [
  {
    to: "/worker/voice",
    label: "Voice & Dashboard",
    short: "Home",
    isActive: (pathname) =>
      pathname === "/worker" ||
      pathname === "/worker/voice" ||
      pathname === "/worker/dashboard",
  },
  { to: "/worker/work-log", label: "Work log", short: "Work" },
  {
    to: "/worker/issues",
    label: "Issues & Alerts",
    short: "Issues",
    isActive: (pathname) =>
      pathname.startsWith("/worker/issues") ||
      pathname === "/worker/report-issue" ||
      pathname.startsWith("/worker/alerts"),
  },
  { to: "/worker/tasks", label: "Tasks", short: "Tasks" },
  { to: "/worker/history", label: "History", short: "History" },
  { to: "/worker/settings", label: "Settings", short: "Settings" },
];

const adminMobile = ["Home", "Machines", "Issues", "Users"];
const permanentWorkerMobile = ["Home", "Work", "Issues", "Tasks"];
const temporaryWorkerMobile = ["Home", "Work", "Issues", "Tasks"];

function isNavActive(item: NavItem, pathname: string) {
  if (item.isActive) return item.isActive(pathname);
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function AdminShell() {
  return <Shell items={adminNav} mobileLabels={adminMobile} home="/admin" />;
}

export function WorkerShell() {
  const session = useDemoDatabase().session;
  const temporary = isTemporaryWorker(session);
  return (
    <Shell
      items={temporary ? temporaryWorkerNav : permanentWorkerNav}
      mobileLabels={temporary ? temporaryWorkerMobile : permanentWorkerMobile}
      home="/worker/voice"
    />
  );
}

function Shell({
  items,
  mobileLabels,
  home,
}: {
  items: NavItem[];
  mobileLabels: string[];
  home: string;
}) {
  const db = useDemoDatabase();
  const session = db.session;
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!session) {
      navigate("/", { replace: true });
      return;
    }
    const membership = db.memberships.find(
      (item) =>
        item.userId === session.userId && item.organisationId === session.organisationId,
    );
    if (membership && !membershipAllowsLogin(membership)) {
      demoStore.logout();
      navigate("/", { replace: true });
    }
  }, [session, navigate, db.memberships]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setStatus(db.flags.forceLoadError ? "error" : "ready");
    }, 280);
    return () => window.clearTimeout(handle);
  }, [attempt, db.flags.forceLoadError, session?.organisationId]);

  useEffect(() => {
    setMenuOpen(false);
    setMoreOpen(false);
    setNotifyOpen(false);
  }, [location.pathname]);

  const notifications = useMemo(
    () => (session ? notificationsForSession(db, session) : []),
    [db, session],
  );
  const notificationCount = countNotifications(notifications);

  if (!session) return null;

  const organisation = db.organisations.find(
    (item) => item.id === session.organisationId,
  );
  const membership = db.memberships.find(
    (item) =>
      item.userId === session.userId && item.organisationId === session.organisationId,
  );
  const accessState = membership ? membershipAccessState(membership) : "active";
  const mobileItems = items.filter((item) => mobileLabels.includes(item.short));
  const overflowItems = items.filter(
    (item) => !mobileLabels.includes(item.short) && item.short !== "Settings",
  );
  const current = items.find((item) => isNavActive(item, location.pathname));

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            EF
          </span>
          <div>
            <strong>EchoFloor</strong>
            <span>Operational memory</span>
          </div>
        </div>
        <nav aria-label="Primary">
          <ul className="nav-list">
            {items.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="nav-link"
                  aria-current={
                    isNavActive(item, location.pathname) ? "page" : undefined
                  }
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar-foot">
          <strong>{session.displayName}</strong>
          <div>{labelSessionRole(session)}</div>
          {session.workerAccessType === "temporary" && session.accessExpiresAt ? (
            <p>Access ends {new Date(session.accessExpiresAt).toLocaleString()}</p>
          ) : null}
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{current?.label ?? "EchoFloor"}</h1>
            <p className="muted">
              {organisation?.name}
              {accessState === "suspended" ? " · Suspended" : ""}
            </p>
          </div>
          <div className="topbar-actions">
            {overflowItems.length > 0 ? (
              <button
                type="button"
                className="btn btn-secondary menu-toggle"
                onClick={() => setMoreOpen(true)}
              >
                More
              </button>
            ) : null}
            <AlertBell />
            <div className="notify">
              <button
                type="button"
                className="icon-button"
                aria-haspopup="menu"
                aria-expanded={notifyOpen}
                aria-label={`${notificationCount} notifications`}
                onClick={() => {
                  setNotifyOpen((open) => !open);
                  setMenuOpen(false);
                }}
              >
                <span aria-hidden="true">!</span>
                {notificationCount > 0 ? (
                  <span className="alert-count">{notificationCount}</span>
                ) : null}
              </button>
              {notifyOpen ? (
                <div className="notify-menu" role="menu" aria-label="Notifications">
                  <div className="notify-menu-head">
                    <strong>Notifications</strong>
                    <span className="muted">{notificationCount} open</span>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="muted notify-empty">
                      No open alerts or waiting tasks. Acknowledged alerts and started
                      work leave this list.
                    </p>
                  ) : (
                    <ul className="notify-list">
                      {notifications.map((item) => (
                        <li key={item.id}>
                          <Link
                            className="notify-item"
                            role="menuitem"
                            to={item.to}
                            onClick={() => setNotifyOpen(false)}
                          >
                            <strong>{item.title}</strong>
                            <span className="muted">{item.message}</span>
                            <span className="notify-go">Open</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
            <div className="profile">
              <button
                type="button"
                className="icon-button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
                onClick={() => {
                  setMenuOpen((open) => !open);
                  setNotifyOpen(false);
                }}
              >
                {session.displayName.slice(0, 1)}
              </button>
              {menuOpen ? (
                <div className="profile-menu" role="menu">
                  <div style={{ padding: "8px 12px" }}>
                    <strong>{session.displayName}</strong>
                    <div className="muted">{session.email}</div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <span className="role-chip">{labelSessionRole(session)}</span>
                      <span className="org-chip">{organisation?.name}</span>
                    </div>
                  </div>
                  <NavLink
                    className="menu-item"
                    role="menuitem"
                    to={session.role === "admin" ? "/admin/settings" : "/worker/settings"}
                  >
                    Settings
                  </NavLink>
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      const nextRole = session.role === "admin" ? "worker" : "admin";
                      const result = demoStore.previewRole(
                        nextRole,
                        nextRole === "worker" ? "permanent" : undefined,
                      );
                      if (!result.ok) return;
                      window.location.assign(homePathForSession(result.db.session!));
                    }}
                  >
                    Development only — preview{" "}
                    {session.role === "admin" ? "permanent worker" : "administrator"}
                  </button>
                  {session.role === "admin" ? (
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      onClick={() => {
                        const result = demoStore.previewRole("worker", "temporary");
                        if (!result.ok || !result.db.session) return;
                        window.location.assign(homePathForSession(result.db.session));
                      }}
                    >
                      Development only — preview temporary worker
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => demoStore.setForceLoadError(!db.flags.forceLoadError)}
                  >
                    {db.flags.forceLoadError
                      ? "Development only — clear simulated failure"
                      : "Development only — simulate a failed load"}
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      demoStore.logout();
                      navigate("/");
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main id="main">
          {status === "loading" ? <LoadingState /> : null}
          {status === "error" ? (
            <ErrorState
              title="Records could not be loaded"
              message="A development control is simulating a failed request. Example records were not shown in place of the failure."
              onRetry={() => {
                demoStore.setForceLoadError(false);
                setStatus("loading");
                setAttempt((value) => value + 1);
              }}
            />
          ) : null}
          {status === "ready" ? <Outlet /> : null}
        </main>
        <nav className="bottom-nav" aria-label="Mobile">
          {mobileItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="bottom-link"
              aria-current={
                isNavActive(item, location.pathname) ? "page" : undefined
              }
            >
              {item.short}
            </Link>
          ))}
          {overflowItems.length > 0 ? (
            <button
              type="button"
              className="bottom-link"
              onClick={() => setMoreOpen(true)}
            >
              More
            </button>
          ) : null}
        </nav>
        {moreOpen ? (
          <>
            <div className="sheet-backdrop" onClick={() => setMoreOpen(false)} />
            <div
              className="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="More destinations"
            >
              <div className="stack">
                {overflowItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className="nav-link"
                    onClick={() => setMoreOpen(false)}
                  >
                    {item.label}
                  </NavLink>
                ))}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setMoreOpen(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
      <span className="sr-only">{home}</span>
    </div>
  );
}
