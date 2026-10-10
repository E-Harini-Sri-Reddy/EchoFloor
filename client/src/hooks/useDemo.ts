import { useSyncExternalStore } from "react";
import { getDatabase, subscribe } from "@/services/demoStore";

export function useDemoDatabase() {
  return useSyncExternalStore(subscribe, getDatabase, getDatabase);
}
