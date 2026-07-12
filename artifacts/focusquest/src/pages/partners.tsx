import { useState, useEffect } from "react";
import { useGetPartners, useGetMe, useSearchUsers, useSendPartnerRequest, useAcceptPartnerRequest, useDeclinePartnerRequest, PartnershipStatus } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Search, Check, X, UserPlus, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPartnersQueryKey } from "@workspace/api-client-react";

/** Pull a human-readable message out of an API error, falling back if absent. */
function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { data?: unknown } | null)?.data;
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default function Partners() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: partners, isLoading: partnersLoading } = useGetPartners();
  const { data: me } = useGetMe();
  const { data: searchResults, isLoading: searchLoading } = useSearchUsers(
    { q: debouncedSearch },
    { query: { enabled: debouncedSearch.length > 2, queryKey: ["searchUsers", debouncedSearch] } }
  );

  const sendReq = useSendPartnerRequest();
  const acceptReq = useAcceptPartnerRequest();
  const declineReq = useDeclinePartnerRequest();

  const activePartners = partners?.filter(p => p.status === PartnershipStatus.accepted) || [];
  // Incoming requests are the pending ones addressed to me.
  const pendingRequests = partners?.filter(p => p.status === PartnershipStatus.pending && p.recipientId === me?.id) || [];

  // Map of the other user's id -> current relationship status, so search
  // results can reflect an existing tie instead of inviting a duplicate add.
  const relationshipByUserId = new Map<number, PartnershipStatus>();
  for (const p of partners ?? []) {
    if (p.partner && p.status !== PartnershipStatus.declined) {
      relationshipByUserId.set(p.partner.id, p.status);
    }
  }

  const handleSend = (id: number) => {
    sendReq.mutate({ data: { recipientId: id } }, {
      onSuccess: () => {
        toast({ title: "Request sent!" });
        queryClient.invalidateQueries({ queryKey: getGetPartnersQueryKey() });
      },
      onError: (err) => {
        toast({ title: "Couldn't send request", description: errorMessage(err, "Please try again."), variant: "destructive" });
      }
    });
  };

  const handleAccept = (id: number) => {
    acceptReq.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Ally added!", className: "bg-primary/20 text-primary border-primary" });
        queryClient.invalidateQueries({ queryKey: getGetPartnersQueryKey() });
      },
      onError: (err) => {
        toast({ title: "Couldn't accept request", description: errorMessage(err, "Please try again."), variant: "destructive" });
      }
    });
  };

  const handleDecline = (id: number) => {
    declineReq.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPartnersQueryKey() });
      },
      onError: (err) => {
        toast({ title: "Couldn't decline request", description: errorMessage(err, "Please try again."), variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          <Shield className="w-8 h-8 text-primary" />
          Accountability Allies
        </h1>
        <p className="text-muted-foreground mt-1">Stay on track together. Share progress and keep the streak alive.</p>
      </div>

      <Tabs defaultValue="allies" className="w-full">
        <TabsList className="bg-card border border-border w-full justify-start rounded-lg p-1">
          <TabsTrigger value="allies" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded-md">
            My Allies ({activePartners.length})
          </TabsTrigger>
          <TabsTrigger value="requests" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded-md">
            Requests {pendingRequests.length > 0 && <span className="ml-2 bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full text-xs">{pendingRequests.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="find" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded-md">
            Find Allies
          </TabsTrigger>
        </TabsList>

        <TabsContent value="allies" className="mt-6 space-y-4">
          {activePartners.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed border-muted rounded-xl bg-card/50">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-bold text-foreground mb-2">No active allies</h3>
              <p className="text-muted-foreground">Find friends to hold you accountable.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activePartners.map(p => (
                <Card key={p.id} className="bg-card border-border hover:border-primary/50 transition-colors">
                  <CardContent className="p-6 text-center">
                    <div className="w-16 h-16 bg-muted rounded-full mx-auto mb-4 flex items-center justify-center text-2xl font-bold text-muted-foreground border-2 border-primary/20">
                      {p.partner?.username.charAt(0).toUpperCase()}
                    </div>
                    <h3 className="font-bold text-lg">{p.partner?.username}</h3>
                    <p className="text-sm text-primary font-medium">{p.partner?.levelName}</p>
                    <div className="mt-4 pt-4 border-t border-border flex justify-around text-sm text-muted-foreground">
                      <div><span className="font-bold text-foreground block">{p.partner?.totalPoints}</span>XP</div>
                      <div><span className="font-bold text-foreground block">{p.partner?.streakDays}</span>Streak</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="requests" className="mt-6 space-y-4">
          {pendingRequests.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No pending requests.</div>
          ) : (
            <div className="space-y-4">
              {pendingRequests.map(p => (
                <div key={p.id} className="flex items-center justify-between p-4 bg-card rounded-xl border border-border">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center font-bold">
                      {p.partner?.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold">{p.partner?.username}</h4>
                      <p className="text-sm text-muted-foreground">Lv. {p.partner?.currentLevel} • {p.partner?.levelName}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="hover:bg-destructive/20 hover:text-destructive" onClick={() => handleDecline(p.id)}>
                      <X className="w-5 h-5" />
                    </Button>
                    <Button size="icon" className="bg-primary hover:bg-primary/80 text-background" onClick={() => handleAccept(p.id)}>
                      <Check className="w-5 h-5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="find" className="mt-6 space-y-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by username..."
              className="pl-10 h-12 text-lg border-primary/20 focus:border-primary bg-card"
            />
          </div>

          <div className="space-y-4">
            {searchLoading && <div className="text-center text-primary animate-pulse py-8">Scanning network...</div>}
            
            {!searchLoading && searchResults && searchResults.length > 0 ? (
              searchResults.map(u => {
                const relationship = relationshipByUserId.get(u.id);
                return (
                <div key={u.id} className="flex items-center justify-between p-4 bg-card rounded-xl border border-border">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center font-bold">
                      {u.username.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold">{u.username}</h4>
                      <p className="text-sm text-muted-foreground">Lv. {u.currentLevel} • {u.totalPoints} XP</p>
                    </div>
                  </div>
                  {relationship === PartnershipStatus.accepted ? (
                    <Button variant="outline" className="border-primary/30 text-muted-foreground" disabled>
                      <Check className="w-4 h-4 mr-2" /> Allies
                    </Button>
                  ) : relationship === PartnershipStatus.pending ? (
                    <Button variant="outline" className="border-primary/30 text-muted-foreground" disabled>
                      <Check className="w-4 h-4 mr-2" /> Pending
                    </Button>
                  ) : (
                    <Button variant="outline" className="border-primary/50 text-primary hover:bg-primary/20" onClick={() => handleSend(u.id)} disabled={sendReq.isPending}>
                      <UserPlus className="w-4 h-4 mr-2" /> Add Ally
                    </Button>
                  )}
                </div>
                );
              })
            ) : debouncedSearch.length > 2 && !searchLoading ? (
              <div className="text-center text-muted-foreground py-8">No users found matching "{debouncedSearch}"</div>
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
