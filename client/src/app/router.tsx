import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  homePathForSession,
  isTemporaryWorker,
  temporaryWorkerMayOpen,
} from "@/domain/access";
import { useDemoDatabase } from "@/hooks/useDemo";
import { AdminShell, WorkerShell } from "@/layouts/Shells";
import { AccessDeniedPage } from "@/pages/AccessDeniedPage";
import { NfcEntryPage } from "@/pages/NfcEntryPage";
import { EntryPage } from "@/pages/auth/EntryPage";
import { AlertDetailPage, AlertListPage } from "@/features/alerts/AlertViews";
import { ReportIssuePage } from "@/features/alerts/ReportIssuePage";
import { AdminOverviewPage } from "@/features/dashboard/AdminOverview";
import { WorkerDashboardPage } from "@/features/dashboard/WorkerDashboard";
import { HandoverPage, MyShiftPage } from "@/features/handovers/HandoverViews";
import { MachineDetailPage, MachineListPage } from "@/features/machines/MachineViews";
import { MemoryDetailPage, MemoryExplorerPage } from "@/features/memories/MemoryExplorer";
import { SettingsPage } from "@/features/settings/SettingsViews";
import { AdminTasksPage, WorkerTasksPage } from "@/features/tasks/TaskViews";
import {
  DamageRepairDetailPage,
  DamageRepairListPage,
} from "@/features/temporary/TemporaryWorkerViews";
import { VoiceAssistantPage } from "@/features/voice/VoiceAssistant";
import type { MembershipRole } from "@/types/domain";
import type { ReactNode } from "react";

function RequireRole({ role, children }: { role: MembershipRole; children: ReactNode }) {
  const session = useDemoDatabase().session;
  if (!session) return <Navigate to="/" replace />;
  if (session.role !== role) return <Navigate to="/access-denied" replace />;
  return children;
}

function PermanentWorkerOnly({ children }: { children: ReactNode }) {
  const session = useDemoDatabase().session;
  if (!session) return <Navigate to="/" replace />;
  if (isTemporaryWorker(session)) return <Navigate to="/access-denied" replace />;
  return children;
}

function TemporaryWorkerGate({ children }: { children: ReactNode }) {
  const session = useDemoDatabase().session;
  const location = useLocation();
  if (!session) return <Navigate to="/" replace />;
  if (isTemporaryWorker(session) && !temporaryWorkerMayOpen(location.pathname)) {
    return <Navigate to="/access-denied" replace />;
  }
  return children;
}

function WorkerHome() {
  const session = useDemoDatabase().session;
  if (!session) return null;
  if (isTemporaryWorker(session)) {
    return <Navigate to="/worker/voice" replace />;
  }
  return <WorkerDashboardPage />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<EntryPage />} />
      <Route path="/access-denied" element={<AccessDeniedPage />} />
      <Route path="/nfc/:tagId" element={<NfcEntryPage />} />
      <Route
        path="/admin"
        element={
          <RequireRole role="admin">
            <AdminShell />
          </RequireRole>
        }
      >
        <Route index element={<AdminOverviewPage />} />
        <Route path="machines" element={<MachineListPage role="admin" />} />
        <Route path="machines/:machineId" element={<MachineDetailPage role="admin" />} />
        <Route path="tasks" element={<AdminTasksPage />} />
        <Route path="voice" element={<VoiceAssistantPage role="admin" />} />
        <Route path="report-issue" element={<ReportIssuePage role="admin" />} />
        <Route path="memories" element={<MemoryExplorerPage />} />
        <Route path="memories/:memoryId" element={<MemoryDetailPage />} />
        <Route path="handover" element={<HandoverPage />} />
        <Route path="alerts" element={<AlertListPage role="admin" />} />
        <Route
          path="alerts/report"
          element={<Navigate to="/admin/report-issue" replace />}
        />
        <Route path="alerts/:alertId" element={<AlertDetailPage role="admin" />} />
        <Route path="settings" element={<SettingsPage role="admin" />} />
      </Route>
      <Route
        path="/worker"
        element={
          <RequireRole role="worker">
            <TemporaryWorkerGate>
              <WorkerShell />
            </TemporaryWorkerGate>
          </RequireRole>
        }
      >
        <Route index element={<WorkerHome />} />
        <Route
          path="machines"
          element={
            <PermanentWorkerOnly>
              <MachineListPage role="worker" />
            </PermanentWorkerOnly>
          }
        />
        <Route
          path="machines/:machineId"
          element={
            <PermanentWorkerOnly>
              <MachineDetailPage role="worker" />
            </PermanentWorkerOnly>
          }
        />
        <Route path="voice" element={<VoiceAssistantPage role="worker" />} />
        <Route path="report-issue" element={<ReportIssuePage role="worker" />} />
        <Route path="tasks" element={<WorkerTasksPage />} />
        <Route path="history" element={<DamageRepairListPage />} />
        <Route path="history/:memoryId" element={<DamageRepairDetailPage />} />
        <Route path="summary" element={<Navigate to="/worker/voice" replace />} />
        <Route path="alerts" element={<AlertListPage role="worker" />} />
        <Route
          path="alerts/report"
          element={<Navigate to="/worker/report-issue" replace />}
        />
        <Route path="alerts/:alertId" element={<AlertDetailPage role="worker" />} />
        <Route
          path="shift"
          element={
            <PermanentWorkerOnly>
              <MyShiftPage />
            </PermanentWorkerOnly>
          }
        />
        <Route path="settings" element={<SettingsPage role="worker" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export { homePathForSession };
