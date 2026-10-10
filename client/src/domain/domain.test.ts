import { describe, expect, it } from "vitest";
import {
  isTemporaryWorker,
  membershipAccessState,
  temporaryWorkerMayOpen,
} from "@/domain/access";
import { answerFromRecords, classifyIntent } from "@/domain/assistant";
import { constraintDisplayStatus, isConstraintActive } from "@/domain/constraints";
import { diffMemoryEdit, memoryToEditable } from "@/domain/memoryEdits";
import {
  assignWorkerToShift,
  createReport,
  createTask,
  acceptShiftAssignment,
  acknowledgeAlert,
  inviteWorker,
  loginAsEmail,
  loginWithGoogle,
  loginWithPassword,
  registerOrganisation,
  reportMachineIssue,
  setPermanentWorkerSuspension,
  updateMemory,
  updateShiftPolicy,
  updateTaskStatus,
} from "@/domain/operations";
import { authProvidersOf } from "@/domain/credentials";
import { notificationsForSession } from "@/domain/notifications";
import {
  alertsFor,
  liveAlertsFor,
  machinesFor,
  memoryById,
  tasksFor,
} from "@/domain/queries";
import { shiftPolicyOf, timingChangeAllowed } from "@/domain/shifts";
import {
  buildMachineUsageInsight,
  damageRepairMemoriesFor,
} from "@/domain/workSummary";
import { createSeed, DEMO_PASSWORD, IDS } from "@/fixtures/seed";
import type { DemoDatabase } from "@/types/domain";

function asAdmin(db: DemoDatabase): DemoDatabase {
  const result = loginAsEmail(db, "admin@northstar.example");
  if (!result.ok) throw new Error(result.message);
  return result.db;
}

function asWorker(db: DemoDatabase): DemoDatabase {
  const result = loginAsEmail(db, "worker@northstar.example");
  if (!result.ok) throw new Error(result.message);
  return result.db;
}

describe("tenant isolation", () => {
  it("keeps Harbourline machines and alerts out of Northstar", () => {
    const db = createSeed();
    const machines = machinesFor(db, IDS.northstar);
    expect(machines.map((machine) => machine.id)).not.toContain(IDS.harbourM104);
    expect(machines.every((machine) => machine.organisationId === IDS.northstar)).toBe(
      true,
    );
    const alerts = alertsFor(db, IDS.northstar);
    expect(alerts.some((alert) => alert.id === "alert_harbour")).toBe(false);
  });

  it("does not answer a Northstar question with the other organisation's pressure note", () => {
    const db = createSeed();
    const machine = db.machines.find((item) => item.id === IDS.m104);
    if (!machine) throw new Error("missing machine");
    const memories = db.memories.filter(
      (memory) =>
        memory.organisationId === IDS.northstar && memory.machineId === IDS.m104,
    );
    const answer = answerFromRecords(
      "Has this machine had a pressure error before?",
      machine,
      memories,
    );
    expect(answer.evidence.some((item) => item.memoryId === IDS.harbourPressure)).toBe(
      false,
    );
    expect(answer.text.toLowerCase()).not.toContain("harbourline");
    expect(answer.mode).toBe("fixture_retrieval");
  });
});

describe("live operational alerts", () => {
  const demoNow = new Date("2026-10-10T12:54:00.000Z");

  it("keeps only unexpired operational alerts in the Live Alerts feed", () => {
    const db = createSeed();
    const live = liveAlertsFor(db, IDS.northstar, { now: demoNow });
    expect(live.some((alert) => alert.id === "alert_m207_maintenance")).toBe(true);
    expect(live.some((alert) => alert.id === "alert_m104_overheat")).toBe(true);
    expect(live.some((alert) => alert.id === "alert_expired_hold")).toBe(false);
    expect(live.some((alert) => alert.id === "alert_seal_review")).toBe(false);
    expect(live.some((alert) => alert.severity === "info")).toBe(false);
    expect(live.some((alert) => alert.id === "alert_harbour")).toBe(false);
  });

  it("requires a photo when reporting a machine issue", () => {
    const worker = asWorker(createSeed());
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const missingPhoto = reportMachineIssue(worker, {
      machineId: IDS.m104,
      issueKind: "breakdown",
      title: "Press stopped mid-cycle",
      description: "The press jammed and will not restart.",
      expiresAt,
      photoDataUrl: "",
      photoName: "",
      photoBytes: 0,
      photoSource: "upload",
    });
    expect(missingPhoto.ok).toBe(false);

    const created = reportMachineIssue(worker, {
      machineId: IDS.m104,
      issueKind: "breakdown",
      title: "Press stopped mid-cycle",
      description: "The press jammed and will not restart.",
      expiresAt,
      photoDataUrl: "data:image/png;base64,aaa",
      photoName: "jam.png",
      photoBytes: 120,
      photoSource: "camera",
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.data?.type).toBe("machine_breakdown");
      expect(created.data?.photoDataUrl).toContain("data:image/");
      expect(created.data?.photoSource).toBe("camera");
      expect(created.data?.photoAiReview?.status).toBe("needs_admin_review");
      expect(
        liveAlertsFor(created.db, IDS.northstar, {
          now: new Date(),
        }).some((alert) => alert.id === created.data?.id),
      ).toBe(true);
    }
  });
});

describe("constraints", () => {
  it("does not treat an expired window as active when the stored status is still active", () => {
    const db = createSeed();
    const constraint = db.constraints.find((item) => item.id === IDS.halfSpeed);
    if (!constraint) throw new Error("missing constraint");
    const now = new Date("2026-10-10T12:54:00.000Z");
    expect(constraint.status).toBe("active");
    expect(isConstraintActive(constraint, now)).toBe(false);
    expect(constraintDisplayStatus(constraint, now)).toBe("Expired");
  });

  it("keeps the inspect-seal constraint active inside its window", () => {
    const db = createSeed();
    const constraint = db.constraints.find((item) => item.id === IDS.inspect);
    if (!constraint) throw new Error("missing constraint");
    expect(isConstraintActive(constraint, new Date("2026-10-10T12:54:00.000Z"))).toBe(
      true,
    );
  });
});

describe("memory edits", () => {
  it("does not change the record when the caller only prepares a diff", () => {
    const db = asAdmin(createSeed());
    const memory = memoryById(db, IDS.northstar, IDS.seal);
    if (!memory) throw new Error("missing memory");
    const draft = { ...memoryToEditable(memory), title: "Seal replaced and observed" };
    const changes = diffMemoryEdit(memory, draft);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.label).toBe("Title");
    expect(memoryById(db, IDS.northstar, IDS.seal)?.title).toBe(memory.title);
  });

  it("rejects a worker edit and applies an admin edit only through updateMemory", () => {
    const original = memoryById(createSeed(), IDS.northstar, IDS.seal);
    if (!original) throw new Error("missing memory");
    const draft = {
      ...memoryToEditable(original),
      content: "Replaced the seal and logged the half-speed request.",
    };
    const changes = diffMemoryEdit(original, draft);
    const worker = updateMemory(
      asWorker(createSeed()),
      IDS.seal,
      draft,
      original.currentRevision,
      changes,
    );
    expect(worker.ok).toBe(false);
    if (!worker.ok) expect(worker.code).toBe("FORBIDDEN");

    const admin = updateMemory(
      asAdmin(createSeed()),
      IDS.seal,
      draft,
      original.currentRevision,
      changes,
    );
    expect(admin.ok).toBe(true);
    if (admin.ok) {
      expect(memoryById(admin.db, IDS.northstar, IDS.seal)?.content).toContain(
        "half-speed request",
      );
      expect(memoryById(admin.db, IDS.northstar, IDS.seal)?.currentRevision).toBe(2);
      expect(admin.db.auditEvents.some((event) => event.action === "memory.update")).toBe(
        true,
      );
    }
  });
});

describe("registration and reports", () => {
  it("makes the registering user an administrator of an empty organisation", () => {
    const result = registerOrganisation(createSeed(), {
      organisationName: "Cedar Stampings",
      displayName: "Amina Yusuf",
      email: "amina@cedar.example",
      password: "not-stored-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.db.session?.role).toBe("admin");
      expect(
        machinesFor(result.db, result.db.session?.organisationId ?? ""),
      ).toHaveLength(0);
      expect(result.db.users.some((user) => "password" in user)).toBe(false);
    }
  });

  it("lets a worker create a new report without editing the seal memory", () => {
    const before = asWorker(createSeed());
    const created = createReport(before, {
      machineId: IDS.m104,
      title: "Half-speed observation",
      content: "Replaced the seal. Run at half-speed for four hours.",
      type: "maintenance",
      sourceType: "text",
    });
    expect(created.ok).toBe(true);
    if (created.ok && created.data) {
      expect(created.data.status).toBe("pending_review");
      expect(created.data.id).not.toBe(IDS.seal);
      expect(memoryById(created.db, IDS.northstar, IDS.seal)?.content).toBe(
        memoryById(before, IDS.northstar, IDS.seal)?.content,
      );
    }
  });
});

describe("shift schedule", () => {
  it("blocks consecutive assignments that break the rest window", () => {
    const admin = asAdmin(createSeed());
    // Luis is already on Afternoon. Morning on the same day ends when Afternoon starts.
    const blocked = assignWorkerToShift(admin, {
      shiftId: IDS.morningShift,
      userId: IDS.luis,
      machineIds: [IDS.m104],
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/rest/i);

    const okNight = assignWorkerToShift(admin, {
      shiftId: IDS.nightShift,
      userId: IDS.anita,
      machineIds: [],
    });
    // Anita is on Morning; Night starts 8h after Morning ends — exactly at the rest edge.
    // gapAfterOther = nightStart - morningEnd = 0 for contiguous 8h templates? 
    // Morning ends 08:30Z, Night starts 16:30Z = 8h gap. minRest is 8h, so gap < 8h is violation; gap === 8h is OK.
    expect(okNight.ok).toBe(true);
  });

  it("locks timing edits inside the cooldown window", () => {
    const admin = asAdmin(createSeed());
    const organisation = admin.organisations.find((item) => item.id === IDS.northstar);
    const policy = shiftPolicyOf(organisation);
    const demoNow = new Date("2026-10-10T12:54:00.000Z");
    expect(timingChangeAllowed(policy, demoNow).allowed).toBe(false);

    const attempt = updateShiftPolicy(
      admin,
      {
        templates: policy.templates.map((template) =>
          template.kind === "morning"
            ? { ...template, startLocal: "05:00" }
            : template,
        ),
        rotation: policy.rotation,
        minRestHoursBetweenShifts: policy.minRestHoursBetweenShifts,
      },
      demoNow,
    );
    expect(attempt.ok).toBe(false);

    const rotationOnly = updateShiftPolicy(
      admin,
      {
        templates: policy.templates,
        rotation: "fortnightly",
        minRestHoursBetweenShifts: policy.minRestHoursBetweenShifts,
      },
      demoNow,
    );
    expect(rotationOnly.ok).toBe(true);
  });
});

describe("task assignment", () => {
  it("lets an administrator assign a prioritized task only to an active worker", () => {
    const admin = asAdmin(createSeed());
    const created = createTask(admin, {
      assigneeUserId: IDS.luis,
      machineId: IDS.m104,
      title: "Check hydraulic hose",
      description: "Walk the press and look for hose wear before the next run.",
      priority: "urgent",
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.data?.priority).toBe("urgent");
      expect(
        tasksFor(created.db, IDS.northstar, { assigneeUserId: IDS.luis }).some(
          (task) => task.title === "Check hydraulic hose",
        ),
      ).toBe(true);
    }

    const workerDenied = createTask(asWorker(createSeed()), {
      assigneeUserId: IDS.anita,
      machineId: IDS.m118,
      title: "Should fail",
      description: "Workers cannot assign tasks to others.",
      priority: "low",
    });
    expect(workerDenied.ok).toBe(false);

    const started = updateTaskStatus(
      asWorker(createSeed()),
      IDS.taskLuisInspect,
      "in_progress",
    );
    expect(started.ok).toBe(true);
  });
});

describe("assistant intent", () => {
  it("classifies the sample report and a pressure question differently", () => {
    expect(classifyIntent("Replaced the seal. Run at half-speed for four hours.")).toBe(
      "report",
    );
    expect(classifyIntent("Has this machine had a pressure error before?")).toBe(
      "question",
    );
  });
});

describe("permanent and temporary worker access", () => {
  it("marks Luis permanent and Anita temporary with an open window", () => {
    const luis = loginAsEmail(createSeed(), "worker@northstar.example");
    const anita = loginAsEmail(createSeed(), "anita.shah@northstar.example");
    expect(luis.ok).toBe(true);
    expect(anita.ok).toBe(true);
    if (luis.ok && anita.ok) {
      expect(luis.db.session?.workerAccessType).toBe("permanent");
      expect(isTemporaryWorker(anita.db.session)).toBe(true);
      expect(temporaryWorkerMayOpen("/worker/voice")).toBe(true);
      expect(temporaryWorkerMayOpen("/worker/history")).toBe(true);
      expect(temporaryWorkerMayOpen("/worker/alerts")).toBe(true);
      expect(temporaryWorkerMayOpen("/worker/report-issue")).toBe(true);
      expect(temporaryWorkerMayOpen("/worker/summary")).toBe(false);
      expect(temporaryWorkerMayOpen("/worker/machines")).toBe(false);
    }
  });

  it("suspends permanent workers and refuses temporary suspension", () => {
    const admin = asAdmin(createSeed());
    const luisMembership = admin.memberships.find((item) => item.userId === IDS.luis);
    const anitaMembership = admin.memberships.find((item) => item.userId === IDS.anita);
    if (!luisMembership || !anitaMembership) throw new Error("missing membership");

    const suspended = setPermanentWorkerSuspension(admin, luisMembership.id, true);
    expect(suspended.ok).toBe(true);
    if (suspended.ok) {
      const blocked = loginAsEmail(suspended.db, "worker@northstar.example");
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.message).toMatch(/suspended/i);
    }

    const tempSuspend = setPermanentWorkerSuspension(admin, anitaMembership.id, true);
    expect(tempSuspend.ok).toBe(false);
  });

  it("records temporary invites with an access end and keeps work logs summary-only", () => {
    const admin = asAdmin(createSeed());
    const invited = inviteWorker(admin, {
      email: "temp.hire@northstar.example",
      temporaryPassword: "TempHire-24h!",
      workerAccessType: "temporary",
      accessDuration: "24h",
    });
    expect(invited.ok).toBe(true);
    if (invited.ok) {
      const membership = invited.db.memberships.find(
        (item) =>
          invited.db.users.find((user) => user.id === item.userId)?.emailNormalized ===
          "temp.hire@northstar.example",
      );
      expect(membership?.workerAccessType).toBe("temporary");
      expect(membership?.accessExpiresAt).toBeTruthy();
      expect(membershipAccessState(membership!)).toBe("active");
      const passwordLogin = loginWithPassword(
        invited.db,
        "temp.hire@northstar.example",
        "TempHire-24h!",
      );
      expect(passwordLogin.ok).toBe(true);
    }

    const machine = machinesFor(admin, IDS.northstar).find((item) => item.id === IDS.m104);
    if (!machine) throw new Error("missing machine");
    const insight = buildMachineUsageInsight(admin, IDS.northstar, machine);
    expect(insight).not.toBeNull();
    expect(insight?.overview).toMatch(/Entire usage summary|No daily usage notes/i);
    expect(insight?.insights.some((line) => /On average, daily/i.test(line))).toBe(true);
    expect(insight?.overview).toContain("No AI provider was called");
    const damage = damageRepairMemoriesFor(admin, IDS.northstar);
    expect(damage.some((memory) => memory.id === IDS.seal)).toBe(true);
    expect(damage.some((memory) => memory.id === IDS.m104Usage)).toBe(false);
  });
});

describe("notifications", () => {
  it("drops alert and task notices after acknowledge or start", () => {
    const worker = asWorker(createSeed());
    const before = notificationsForSession(worker, worker.session!);
    expect(before.some((item) => item.kind === "alert")).toBe(true);
    expect(before.some((item) => item.kind === "task")).toBe(true);

    const openAlert = worker.alerts.find(
      (alert) =>
        alert.organisationId === IDS.northstar &&
        alert.status === "open" &&
        alert.severity !== "info",
    );
    if (!openAlert) throw new Error("missing open alert");
    const acked = acknowledgeAlert(worker, openAlert.id);
    expect(acked.ok).toBe(true);
    if (!acked.ok) return;

    const afterAck = notificationsForSession(acked.db, acked.db.session!);
    expect(afterAck.some((item) => item.id === `alert:${openAlert.id}`)).toBe(false);

    const openTask = acked.db.tasks.find(
      (task) => task.assigneeUserId === IDS.luis && task.status === "open",
    );
    if (!openTask) throw new Error("missing open task");
    const started = updateTaskStatus(acked.db, openTask.id, "in_progress");
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const afterStart = notificationsForSession(started.db, started.db.session!);
    expect(afterStart.some((item) => item.id === `task:${openTask.id}`)).toBe(false);
  });

  it("drops assignment notices after accept for a permanent worker", () => {
    let db = createSeed();
    // Give Luis an unacknowledged assignment for this check.
    db = {
      ...db,
      assignments: db.assignments.map((item) =>
        item.id === IDS.luisAssignment
          ? { ...item, status: "assigned" as const }
          : item,
      ),
    };
    const worker = asWorker(db);
    const before = notificationsForSession(worker, worker.session!);
    expect(before.some((item) => item.id === `assignment:${IDS.luisAssignment}`)).toBe(
      true,
    );
    const accepted = acceptShiftAssignment(worker, IDS.luisAssignment);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const after = notificationsForSession(accepted.db, accepted.db.session!);
    expect(after.some((item) => item.id === `assignment:${IDS.luisAssignment}`)).toBe(
      false,
    );
  });
});

describe("auth providers", () => {
  it("uses the same user id for password and Google sign-in", () => {
    const seed = createSeed();
    const byPassword = loginWithPassword(
      seed,
      "worker@northstar.example",
      DEMO_PASSWORD,
    );
    expect(byPassword.ok).toBe(true);
    if (!byPassword.ok) return;

    const byGoogle = loginWithGoogle(seed, "worker@northstar.example");
    expect(byGoogle.ok).toBe(true);
    if (!byGoogle.ok) return;

    expect(byGoogle.data?.session.userId).toBe(byPassword.data?.session.userId);
    expect(byGoogle.data?.session.organisationId).toBe(
      byPassword.data?.session.organisationId,
    );
    const user = byGoogle.db.users.find((item) => item.id === IDS.luis);
    expect(authProvidersOf(user!)).toContain("google");
    expect(authProvidersOf(user!)).toContain("password");
  });

  it("rejects an incorrect password", () => {
    const result = loginWithPassword(
      createSeed(),
      "admin@northstar.example",
      "wrong-password",
    );
    expect(result.ok).toBe(false);
  });
});
