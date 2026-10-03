import { useEffect } from "react";
import { documentStore } from "../state/store";
import { trackRecovery } from "../state/recoveryTracker";

export function useRecovery(report: (error: string) => void) {
  useEffect(() => {
    const recovery = trackRecovery(documentStore, report);
    const timer = setInterval(() => { void recovery.save(); }, 15000);
    return () => {
      clearInterval(timer);
      recovery.dispose();
    };
  }, [report]);
}
