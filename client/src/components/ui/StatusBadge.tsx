import { statusTone } from "@/domain/labels";

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge badge-${statusTone(status)}`}>{label}</span>;
}
