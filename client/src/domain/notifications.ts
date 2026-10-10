import { isTemporaryWorker } from "@/domain/access";
import { assignmentsForUser, liveAlertsFor, tasksFor } from "@/domain/queries";
import type { DemoDatabase, Session } from "@/types/domain";

export type NotificationKind = "alert" | "task" | "assignment" | "handover";

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  to: string;
  createdAt: string;
}

function basePath(session: Session): "/admin" | "/worker" {
  return session.role === "admin" ? "/admin" : "/worker";
}

/**
 * Actionable inbox items for the bell. Counts drop when:
 * - an alert is acknowledged (or resolved),
 * - a task moves off `open` (started / completed / cancelled),
 * - a shift assignment is accepted,
 * - a published handover is acknowledged.
 */
export function notificationsForSession(
  db: DemoDatabase,
  session: Session,
  now: Date = new Date(),
): AppNotification[] {
  const base = basePath(session);
  const items: AppNotification[] = [];

  const alerts = liveAlertsFor(db, session.organisationId, {
    now,
    audienceUserId: session.role === "worker" ? session.userId : undefined,
  }).filter((alert) => alert.status === "open");

  for (const alert of alerts) {
    const reviewHint =
      alert.photoAiReview?.status === "needs_admin_review" && session.role === "admin"
        ? " · Photo needs admin review"
        : "";
    items.push({
      id: `alert:${alert.id}`,
      kind: "alert",
      title: alert.title,
      message: `Needs acknowledgement · Live alert${reviewHint}`,
      to: `${base}/alerts/${alert.id}`,
      createdAt: alert.createdAt,
    });
  }

  const taskOptions =
    session.role === "worker"
      ? { assigneeUserId: session.userId, status: "open" as const }
      : { status: "open" as const };

  for (const task of tasksFor(db, session.organisationId, taskOptions)) {
    items.push({
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      message:
        session.role === "worker"
          ? "New task · Start work to clear this notice"
          : "Open task · Waiting for the worker to start",
      to: `${base}/tasks?task=${encodeURIComponent(task.id)}`,
      createdAt: task.createdAt,
    });
  }

  // My Shift (assignment / handover ack) is permanent-worker only.
  if (session.role === "worker" && !isTemporaryWorker(session)) {
    const assignments = assignmentsForUser(
      db,
      session.organisationId,
      session.userId,
    ).filter((assignment) => assignment.status === "assigned");

    for (const assignment of assignments) {
      const shift = db.shifts.find((item) => item.id === assignment.shiftId);
      items.push({
        id: `assignment:${assignment.id}`,
        kind: "assignment",
        title: shift ? `${shift.name} assignment` : "Shift assignment",
        message: "Acknowledge this assignment to clear this notice",
        to: "/worker/shift",
        createdAt: assignment.createdAt,
      });
    }

    const handover = db.handovers.find(
      (item) =>
        item.organisationId === session.organisationId && item.status === "published",
    );
    if (handover) {
      items.push({
        id: `handover:${handover.id}`,
        kind: "handover",
        title: handover.title,
        message: "Handover waiting for acknowledgement",
        to: "/worker/shift",
        createdAt: handover.updatedAt,
      });
    }
  }

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function countNotifications(items: AppNotification[]): number {
  return items.length;
}
