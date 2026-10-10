type MemoryLike = Record<string, unknown>;

function line(label: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return `${label}: ${text}`;
}

function machineLabel(memory: MemoryLike, machineName?: string): string | null {
  if (machineName) return line("Machine", machineName);
  if (typeof memory.machineName === "string" && memory.machineName.trim()) {
    return line("Machine", memory.machineName);
  }
  return null;
}

function workerReportSection(memory: MemoryLike): string[] {
  const report = memory.workerReport as Record<string, unknown> | undefined;
  if (!report) return [];
  const parts: string[] = [];
  const machineIdentifier = report.machineIdentifier;
  if (typeof machineIdentifier === "string" && machineIdentifier.trim()) {
    parts.push(`Machine identifier: ${machineIdentifier.trim()}`);
  }
  const issue = report.issue as Record<string, unknown> | undefined;
  if (issue && typeof issue.description === "string" && issue.description.trim()) {
    parts.push(`Issue: ${issue.description.trim()}`);
  }
  const actions = report.actionsTaken;
  if (Array.isArray(actions) && actions.length > 0) {
    parts.push(
      `Actions taken: ${actions.map((item) => String(item).trim()).filter(Boolean).join("; ")}`,
    );
  }
  const constraints = report.constraints;
  if (Array.isArray(constraints)) {
    for (const item of constraints) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const desc = String(row.description ?? "").trim();
      const duration = String(row.duration ?? "").trim();
      if (desc) {
        parts.push(duration ? `Constraint: ${desc} (${duration})` : `Constraint: ${desc}`);
      }
    }
  }
  const uncertainties = report.uncertainties;
  if (Array.isArray(uncertainties) && uncertainties.length > 0) {
    parts.push(
      `Uncertainties: ${uncertainties.map((item) => String(item).trim()).filter(Boolean).join("; ")}`,
    );
  }
  return parts;
}

/**
 * Deterministic searchable text for embeddings and handover payloads (no LLM).
 */
export function buildSearchableText(
  memory: MemoryLike,
  options?: { machineName?: string },
): string {
  const chunks: string[] = [];
  const title = line("Title", memory.title);
  if (title) chunks.push(title);
  const summary = line("Summary", memory.summary);
  if (summary) chunks.push(summary);
  const content = line("Content", memory.content);
  if (content) chunks.push(content);
  const machine = machineLabel(memory, options?.machineName);
  if (machine) chunks.push(machine);

  const ctx = memory.machineContext as Record<string, unknown> | undefined;
  if (ctx) {
    const component = line("Component", ctx.component);
    if (component) chunks.push(component);
    const errorCode = line("Error code", ctx.errorCode);
    if (errorCode) chunks.push(errorCode);
    const conditions = ctx.operatingConditions;
    if (Array.isArray(conditions) && conditions.length > 0) {
      chunks.push(
        `Operating conditions: ${conditions.map((item) => String(item).trim()).filter(Boolean).join(", ")}`,
      );
    }
  }

  const resolution = memory.resolution as Record<string, unknown> | undefined;
  if (resolution && typeof resolution.description === "string") {
    const desc = resolution.description.trim();
    if (desc) chunks.push(`Resolution: ${desc}`);
  }

  chunks.push(...workerReportSection(memory));

  const tags = memory.tags;
  if (Array.isArray(tags) && tags.length > 0) {
    chunks.push(`Tags: ${tags.map((item) => String(item).trim()).filter(Boolean).join(", ")}`);
  }

  return chunks.join("\n").trim();
}
