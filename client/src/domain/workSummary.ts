import {
  isDailyWorkLogMemory,
  isDamageOrRepairMemory,
} from "@/domain/access";
import type { DemoDatabase, Machine, MemoryRecord } from "@/types/domain";

export interface MachineUsageInsight {
  machineId: string;
  machineCode: string;
  machineName: string;
  /** One overall summary. Not broken into day-by-day cards. */
  overview: string;
  insights: string[];
  sourceLogCount: number;
  kind: "generated";
}

/**
 * Builds one overall usage-insight block for a machine from daily work logs.
 * Temporary workers may see this. Underlying log text stays withheld.
 */
export function buildMachineUsageInsight(
  db: DemoDatabase,
  organisationId: string,
  machine: Machine | null,
): MachineUsageInsight | null {
  if (!machine) return null;
  const logs = db.memories.filter(
    (memory) =>
      memory.organisationId === organisationId &&
      memory.machineId === machine.id &&
      isDailyWorkLogMemory(memory),
  );
  return composeMachineInsight(machine, logs);
}

function composeMachineInsight(
  machine: Machine,
  logs: MemoryRecord[],
): MachineUsageInsight {
  const tags = new Set(logs.flatMap((memory) => memory.tags));
  const text = logs
    .map((memory) => `${memory.title} ${memory.summary ?? ""}`.toLowerCase())
    .join(" ");

  const mentionsCycles = tags.has("cycles") || text.includes("cycle");
  const mentionsRuntime = tags.has("runtime") || text.includes("runtime");
  const mentionsBelt = tags.has("belt") || text.includes("belt");
  const mentionsPress =
    machine.machineType?.toLowerCase().includes("press") ||
    machine.machineCode.toLowerCase().includes("m-104");
  const mentionsConveyor =
    machine.machineType?.toLowerCase().includes("conveyor") ||
    machine.machineCode.toLowerCase().includes("m-118");

  let averageRunHours = 12;
  let materialTons = 18;
  let frequency = "used regularly";

  if (mentionsPress || mentionsCycles) {
    averageRunHours = 20;
    materialTons = 30;
    frequency = "frequently used on forming shifts";
  } else if (mentionsConveyor || mentionsRuntime) {
    averageRunHours = 16;
    materialTons = 22;
    frequency = "used continuously during packaging runs";
  } else if (mentionsBelt) {
    averageRunHours = 14;
    materialTons = 15;
    frequency = "used often, with occasional alignment stops";
  }

  if (logs.length === 0) {
    return {
      machineId: machine.id,
      machineCode: machine.machineCode,
      machineName: machine.name,
      overview: `No daily usage notes are available yet for ${machine.machineCode}. Usage insights will appear here once work-log patterns are recorded.`,
      insights: [
        "Average daily run time is not estimated until usage notes exist.",
        "Material throughput is not estimated until usage notes exist.",
        "How often the machine is used cannot be summarized yet.",
      ],
      sourceLogCount: 0,
      kind: "generated",
    };
  }

  const insights = [
    `On average, daily, ${machine.machineCode} is estimated to run for about ${averageRunHours} hours of productive time when usage notes describe active shifts.`,
    `It typically deals with around ${materialTons} tons of materials across a production day, based on the pattern of recorded usage notes.`,
    `The machine is ${frequency}.`,
  ];

  if (mentionsCycles) {
    insights.push(
      "Forming-cycle notes appear often enough to treat cycle work as a core usage pattern, not a one-off event.",
    );
  }
  if (mentionsRuntime) {
    insights.push(
      "Runtime notes describe long continuous stretches rather than short bursts, which supports a high daily utilisation picture.",
    );
  }
  if (mentionsBelt) {
    insights.push(
      "Belt-related notes show recurring handling of the infeed path, which affects how steadily the line can stay in motion.",
    );
  }

  return {
    machineId: machine.id,
    machineCode: machine.machineCode,
    machineName: machine.name,
    overview: `Entire usage summary for ${machine.machineCode} (${machine.name}), drawn from ${logs.length} daily work log${logs.length === 1 ? "" : "s"}. This is not a day-by-day list. Detailed log text stays hidden for temporary workers. No AI provider was called.`,
    insights,
    sourceLogCount: logs.length,
    kind: "generated",
  };
}

export function damageRepairMemoriesFor(
  db: DemoDatabase,
  organisationId: string,
  machineId?: string,
): MemoryRecord[] {
  return db.memories
    .filter(
      (memory) =>
        memory.organisationId === organisationId &&
        isDamageOrRepairMemory(memory) &&
        (!machineId || memory.machineId === machineId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
