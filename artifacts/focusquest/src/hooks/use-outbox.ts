import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetTasksQueryKey,
  getGetTasksMomentumQueryKey,
  getGetQuestlinesQueryKey,
  getGetQuestlineQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import type { OutboxEntry } from "@/lib/outbox/core";
import { getOutboxStore, outboxChanged } from "@/lib/outbox/store";
import { drainOutboxLocked } from "@/lib/outbox/replay";
import { replayApi } from "@/lib/outbox/api";

export function useOutboxEntries(): OutboxEntry[] {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void getOutboxStore()
        .then((s) => s.list())
        .then((list) => {
          if (alive) setEntries(list);
        });
    };
    refresh();
    outboxChanged.addEventListener("change", refresh);
    return () => {
      alive = false;
      outboxChanged.removeEventListener("change", refresh);
    };
  }, []);
  return entries;
}

export function useOutboxActions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const syncNow = useCallback(() => {
    void (async () => {
      try {
        const store = await getOutboxStore();
        const result = await drainOutboxLocked(store, replayApi);
        if (!result) return; // another tab is draining
        if (result.synced > 0) {
          queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetTasksMomentumQueryKey() });
          // Replayed captures may belong to a questline — refresh the list
          // counts plus each landed-in questline's open detail screen.
          queryClient.invalidateQueries({ queryKey: getGetQuestlinesQueryKey() });
          for (const id of result.syncedQuestlineIds) {
            queryClient.invalidateQueries({ queryKey: getGetQuestlineQueryKey(id) });
          }
          toast({
            title: `Synced ${result.synced} quest${result.synced === 1 ? "" : "s"} ✓`,
            className: "border-primary",
          });
        }
        if (result.stopped?.authNeeded) {
          toast({ title: "Log in to sync your saved quests" });
        }
      } catch (err) {
        // Belt over the drain module's own hardening: a store/list failure
        // here (e.g. IDB quota, tx abort outside drainOutbox's try) must
        // never surface as an unhandled rejection from this fire-and-forget IIFE.
        console.error("outbox sync failed", err);
      }
    })();
  }, [queryClient, toast]);

  const retry = useCallback(
    (id: string) => {
      void (async () => {
        const store = await getOutboxStore();
        await store.update(id, { status: "queued", lastError: undefined });
        syncNow();
      })();
    },
    [syncNow],
  );

  const discard = useCallback((id: string) => {
    void getOutboxStore().then((s) => s.remove(id));
  }, []);

  return { syncNow, retry, discard };
}

/** Mounted once in Layout: drain on app open and whenever we come back online. */
export function useOutboxSync(): void {
  const { syncNow } = useOutboxActions();
  useEffect(() => {
    syncNow();
    window.addEventListener("online", syncNow);
    return () => window.removeEventListener("online", syncNow);
  }, [syncNow]);
}
