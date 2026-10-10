import { ObjectId } from "mongodb";

export function toId(value: unknown): string {
  if (value instanceof ObjectId) return value.toHexString();
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toHexString" in value) {
    return String((value as { toHexString: () => string }).toHexString());
  }
  return String(value ?? "");
}

export function asObjectId(value: string): ObjectId | null {
  if (!ObjectId.isValid(value)) return null;
  return new ObjectId(value);
}

export function mapDoc<T extends Record<string, unknown>>(
  doc: Record<string, unknown> | null | undefined,
): (T & { id: string }) | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...(rest as T), id: toId(_id) };
}

export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}
