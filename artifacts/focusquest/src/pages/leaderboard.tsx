import { useState } from "react";
import { useGetLeaderboard, GetLeaderboardPeriod } from "@workspace/api-client-react";
import { Trophy, Medal, Star } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Leaderboard() {
  const [period, setPeriod] = useState<GetLeaderboardPeriod>(GetLeaderboardPeriod.weekly);
  
  const { data: leaderboard, isLoading } = useGetLeaderboard({ period });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Trophy className="w-8 h-8 text-primary" />
            Global Rankings
          </h1>
          <p className="text-muted-foreground mt-1">See how you stack up against other commanders.</p>
        </div>

        <Tabs value={period} onValueChange={(v) => setPeriod(v as GetLeaderboardPeriod)}>
          <TabsList className="bg-card border border-border">
            <TabsTrigger value={GetLeaderboardPeriod.weekly} className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              This Week
            </TabsTrigger>
            <TabsTrigger value={GetLeaderboardPeriod.alltime} className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
              All Time
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-lg">
        {isLoading ? (
          <div className="p-12 text-center text-primary animate-pulse font-bold text-xl">Loading ranks...</div>
        ) : (
          <div className="divide-y divide-border">
            <div className="grid grid-cols-12 gap-4 p-4 bg-muted/50 text-xs font-bold text-muted-foreground uppercase tracking-wider">
              <div className="col-span-2 text-center">Rank</div>
              <div className="col-span-6">Commander</div>
              <div className="col-span-4 text-right">Score</div>
            </div>
            
            {leaderboard?.map((entry) => (
              <div 
                key={entry.user.id} 
                className={`grid grid-cols-12 gap-4 p-4 items-center transition-colors hover:bg-muted/30 ${
                  entry.user.id === 1 ? "bg-primary/5 border-l-2 border-primary" : ""
                }`}
              >
                <div className="col-span-2 flex justify-center">
                  {entry.rank === 1 ? (
                    <Trophy className="w-6 h-6 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
                  ) : entry.rank === 2 ? (
                    <Medal className="w-6 h-6 text-gray-300 drop-shadow-[0_0_8px_rgba(209,213,219,0.8)]" />
                  ) : entry.rank === 3 ? (
                    <Medal className="w-6 h-6 text-amber-600 drop-shadow-[0_0_8px_rgba(217,119,6,0.8)]" />
                  ) : (
                    <span className="font-bold text-muted-foreground">{entry.rank}</span>
                  )}
                </div>
                
                <div className="col-span-6 flex items-center gap-3">
                  <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center font-bold text-sm border border-border">
                    {entry.user.username.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-bold flex items-center gap-2">
                      {entry.user.username}
                      {entry.user.id === 1 && <span className="text-[10px] bg-primary text-background px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">You</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">Lv. {entry.user.currentLevel}</div>
                  </div>
                </div>
                
                <div className="col-span-4 text-right">
                  <div className="font-bold text-primary flex items-center justify-end gap-1">
                    <Star className="w-4 h-4 fill-current" />
                    {entry.points}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {entry.tasksCompleted} quests
                  </div>
                </div>
              </div>
            ))}

            {leaderboard?.length === 0 && (
              <div className="p-12 text-center text-muted-foreground">
                No entries found. Be the first!
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
