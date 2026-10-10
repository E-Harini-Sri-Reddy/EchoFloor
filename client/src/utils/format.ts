export function formatTimestamp(iso: string, timeZone = "Asia/Kolkata"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatTimeRange(
  startIso: string,
  endIso: string,
  timeZone = "Asia/Kolkata",
): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Unknown shift window";
  }
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
  });
  return `${day.format(start)}, ${time.format(start)}–${time.format(end)}`;
}

export function shiftWindowLabel(
  startIso: string,
  endIso: string,
  now = new Date(),
): string {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const current = now.getTime();
  if (current < start) {
    return "Scheduled";
  }
  if (current >= start && current < end) {
    return "Within scheduled window";
  }
  return "Scheduled window has ended";
}

export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const start = startIndex(safePage, pageSize);
  return {
    items: items.slice(start, start + pageSize),
    total,
    page: safePage,
    pageCount,
  };
}

function startIndex(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
