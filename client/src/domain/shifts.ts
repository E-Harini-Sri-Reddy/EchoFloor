import type {
  DemoDatabase,
  OrganisationShiftPolicy,
  Shift,
  ShiftKind,
  ShiftRotation,
  ShiftTemplate,
} from "@/types/domain";

export const SHIFT_KINDS: ShiftKind[] = ["morning", "afternoon", "night"];

export const DEFAULT_SHIFT_POLICY: OrganisationShiftPolicy = {
  templates: [
    { kind: "morning", label: "Morning", startLocal: "06:00", durationMinutes: 480 },
    { kind: "afternoon", label: "Afternoon", startLocal: "14:00", durationMinutes: 480 },
    { kind: "night", label: "Night", startLocal: "22:00", durationMinutes: 480 },
  ],
  rotation: "weekly",
  minRestHoursBetweenShifts: 8,
  timingChangeCooldownDays: 14,
  lastTimingChangedAt: null,
};

export function shiftPolicyOf(
  organisation: { settings: { shiftPolicy?: OrganisationShiftPolicy } } | null | undefined,
): OrganisationShiftPolicy {
  const policy = organisation?.settings.shiftPolicy;
  if (!policy || !Array.isArray(policy.templates) || policy.templates.length === 0) {
    return DEFAULT_SHIFT_POLICY;
  }
  return {
    ...DEFAULT_SHIFT_POLICY,
    ...policy,
    templates: SHIFT_KINDS.map((kind) => {
      const found = policy.templates.find((template) => template.kind === kind);
      const fallback = DEFAULT_SHIFT_POLICY.templates.find((item) => item.kind === kind)!;
      return found ?? fallback;
    }),
  };
}

export function labelShiftKind(kind: ShiftKind): string {
  switch (kind) {
    case "morning":
      return "Morning";
    case "afternoon":
      return "Afternoon";
    case "night":
      return "Night";
  }
}

export function labelShiftRotation(rotation: ShiftRotation): string {
  return rotation === "weekly" ? "Weekly" : "Fortnightly (every 14 days)";
}

export function parseLocalTime(value: string): { hours: number; minutes: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return { hours, minutes };
}

/** Build a UTC instant for a local date + HH:mm in a fixed-offset friendly way via Date parsing. */
export function localDateTimeToIso(
  dateLocal: string,
  timeLocal: string,
  timeZone: string,
): string | null {
  const time = parseLocalTime(timeLocal);
  if (!time || !/^\d{4}-\d{2}-\d{2}$/.test(dateLocal)) return null;
  // Approximate with Intl offset for the organisation timezone on that calendar day.
  const probe = new Date(`${dateLocal}T12:00:00.000Z`);
  const offsetMinutes = timezoneOffsetMinutes(timeZone, probe);
  if (offsetMinutes === null) return null;
  const utcMs =
    Date.UTC(
      Number(dateLocal.slice(0, 4)),
      Number(dateLocal.slice(5, 7)) - 1,
      Number(dateLocal.slice(8, 10)),
      time.hours,
      time.minutes,
      0,
      0,
    ) - offsetMinutes * 60_000;
  return new Date(utcMs).toISOString();
}

function timezoneOffsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(raw);
    if (!match) return 0;
    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? "0");
    return sign * (hours * 60 + minutes);
  } catch {
    return null;
  }
}

export function templateWindowForDate(
  template: ShiftTemplate,
  dateLocal: string,
  timeZone: string,
): { startAt: string; endAt: string } | null {
  const startAt = localDateTimeToIso(dateLocal, template.startLocal, timeZone);
  if (!startAt) return null;
  const endAt = new Date(
    new Date(startAt).getTime() + template.durationMinutes * 60_000,
  ).toISOString();
  return { startAt, endAt };
}

export function timingChangeAllowed(
  policy: OrganisationShiftPolicy,
  now = new Date(),
): { allowed: true } | { allowed: false; nextAllowedAt: string; message: string } {
  if (!policy.lastTimingChangedAt) return { allowed: true };
  const last = new Date(policy.lastTimingChangedAt).getTime();
  if (Number.isNaN(last)) return { allowed: true };
  const cooldownMs = policy.timingChangeCooldownDays * 24 * 60 * 60 * 1000;
  const next = last + cooldownMs;
  if (now.getTime() >= next) return { allowed: true };
  const nextAllowedAt = new Date(next).toISOString();
  return {
    allowed: false,
    nextAllowedAt,
    message: `Shift timings were changed recently. They can be edited again after ${policy.timingChangeCooldownDays} days (next allowed change ${nextAllowedAt.slice(0, 10)}).`,
  };
}

export function templatesChanged(
  before: ShiftTemplate[],
  after: ShiftTemplate[],
): boolean {
  return SHIFT_KINDS.some((kind) => {
    const a = before.find((item) => item.kind === kind);
    const b = after.find((item) => item.kind === kind);
    if (!a || !b) return true;
    return a.startLocal !== b.startLocal || a.durationMinutes !== b.durationMinutes;
  });
}

/**
 * Rejects assigning a worker to a shift that starts before the mandatory rest
 * window after another of their assigned shifts has ended (or vice versa).
 */
export function restWindowViolation(
  candidate: Pick<Shift, "startAt" | "endAt">,
  otherShifts: Array<Pick<Shift, "startAt" | "endAt" | "name">>,
  minRestHours: number,
): string | null {
  const minRestMs = minRestHours * 60 * 60 * 1000;
  const start = new Date(candidate.startAt).getTime();
  const end = new Date(candidate.endAt).getTime();
  for (const other of otherShifts) {
    const otherStart = new Date(other.startAt).getTime();
    const otherEnd = new Date(other.endAt).getTime();
    if (Number.isNaN(otherStart) || Number.isNaN(otherEnd)) continue;
    const gapAfterOther = start - otherEnd;
    const gapAfterCandidate = otherStart - end;
    const consecutive =
      (gapAfterOther >= 0 && gapAfterOther < minRestMs) ||
      (gapAfterCandidate >= 0 && gapAfterCandidate < minRestMs);
    const overlapping = start < otherEnd && end > otherStart;
    if (overlapping || consecutive) {
      return `This assignment would leave less than ${minRestHours} hours of rest against “${other.name}”. Workers cannot work two consecutive shifts back-to-back without that rest window.`;
    }
  }
  return null;
}

export function shiftsForOrganisation(
  db: DemoDatabase,
  organisationId: string,
): Shift[] {
  return db.shifts
    .filter((shift) => shift.organisationId === organisationId)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function ensureShiftKind(shift: Shift): ShiftKind {
  if (shift.kind) return shift.kind;
  const name = shift.name.toLowerCase();
  if (name.includes("morning") || name.includes("day")) return "morning";
  if (name.includes("night")) return "night";
  return "afternoon";
}
