import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMyStats, useGetPartners, useGetOpenBodyDoubleRooms,
  useCreateBodyDoubleRoom, useJoinBodyDoubleRoom,
  getGetOpenBodyDoubleRoomsQueryKey, getGetPartnersQueryKey,
} from "@workspace/api-client-react";
import { isUnlocked } from "@/lib/feature-gates";
import { browserTimeZone } from "@/lib/timezone";
import { BodyDoubleRoom } from "@/components/body-double-room";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, DoorOpen } from "lucide-react";

// Act IV Body-Doubling: the Focus-page surface. Gated on the allies unlock
// (Gentle Door L5) and on actually having allies — locked or ally-less users
// see NOTHING (no "make friends first" nag).
export function BodyDoubleCard() {
  const qc = useQueryClient();
  const { data: stats } = useGetMyStats({ tz: browserTimeZone() });
  const alliesUnlocked = isUnlocked(stats?.unlockedFeatures, "allies");

  const { data: partners } = useGetPartners({
    query: { enabled: alliesUnlocked, queryKey: getGetPartnersQueryKey() },
  });
  const acceptedAllies = (partners ?? []).filter((p) => p.status === "accepted").length;

  const roomsQuery = useGetOpenBodyDoubleRooms({
    query: {
      enabled: alliesUnlocked && acceptedAllies > 0,
      refetchInterval: 30_000,
      queryKey: getGetOpenBodyDoubleRoomsQueryKey(),
    },
  });
  const rooms = roomsQuery.data?.rooms ?? [];

  const createMut = useCreateBodyDoubleRoom();
  const joinMut = useJoinBodyDoubleRoom();
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);

  // Auto-resume the room I host or already joined (reload-proof, like the timer).
  const myRoom = rooms.find((r) => r.isMine || r.amMember);
  const myRoomId = myRoom?.id ?? null;
  useEffect(() => {
    if (activeRoomId === null && myRoomId !== null) setActiveRoomId(myRoomId);
  }, [activeRoomId, myRoomId]);

  if (!alliesUnlocked || acceptedAllies === 0) return null;

  const refreshList = () => qc.invalidateQueries({ queryKey: getGetOpenBodyDoubleRoomsQueryKey() });

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Body Double</h2>
        </div>

        {activeRoomId !== null ? (
          <BodyDoubleRoom roomId={activeRoomId} onExit={() => { setActiveRoomId(null); refreshList(); }} />
        ) : (
          <div className="space-y-2">
            {rooms.filter((r) => !r.isMine).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                <div className="text-sm min-w-0">
                  <span className="font-medium">{r.host.displayName ?? r.host.username}</span>
                  <span className="text-muted-foreground">
                    {"'s door is open"}{r.memberCount > 1 ? ` · ${r.memberCount} working` : ""}
                  </span>
                </div>
                <Button
                  size="sm"
                  disabled={joinMut.isPending}
                  onClick={() =>
                    joinMut.mutate({ id: r.id }, {
                      onSuccess: () => setActiveRoomId(r.id),
                      onSettled: refreshList,
                    })
                  }
                >
                  {r.amMember ? "Return" : "Drop in"}
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={createMut.isPending}
              onClick={() =>
                createMut.mutate(undefined, {
                  onSuccess: (room) => setActiveRoomId(room.id),
                  // A 409 means I already host an open room — the list refetch
                  // + auto-resume effect land me back in it.
                  onSettled: refreshList,
                })
              }
            >
              <DoorOpen className="w-4 h-4 mr-1" /> Open a room
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">
              Your allies get a gentle heads-up and can drop in to work alongside you.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
