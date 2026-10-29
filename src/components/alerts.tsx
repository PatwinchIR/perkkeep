"use client";
import { useMemo } from "react";
import { deriveAlerts, type Alert } from "@/lib/alerts";
import { useApp } from "./provider";

// Alerts are derived from the snapshot on every render; nothing is stored except acknowledgements.
export function useAlerts(): Alert[] {
  const { data } = useApp();
  return useMemo(
    () =>
      deriveAlerts({
        data,
        leadDays: data.settings.alert_lead_days,
        acknowledged: data.acknowledgements.map((a) => a.alert_key),
      }),
    [data],
  );
}
