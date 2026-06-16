import { useGetMe, useGetMyStats, useGetMyBadges } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Award, Flame, Target, Trophy, Zap } from "lucide-react";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Mock data for the chart since the backend might not provide a timeseries yet
const generateWeeklyData = () => {
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    data.push({
      name: format(d, 'EEE'),
      xp: Math.floor(Math.random() * 500) + 100, // mock xp
    });
  }
  return data;
};

export default function Progress() {
  const { data: user, isLoading: userLoading } = useGetMe();
  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: userBadges, isLoading: badgesLoading } = useGetMyBadges();

  if (userLoading || statsLoading || badgesLoading) {
    return <div className="p-8 flex justify-center items-center h-64"><Zap className="w-8 h-8 text-primary animate-pulse" /></div>;
  }

  const chartData = generateWeeklyData(); // Real app would use actual timeseries
  if (stats) {
    chartData[6].xp = stats.todayPoints; // Match today's points
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Commander Profile</h1>
        <p className="text-muted-foreground mt-1">Review your career stats and achievements.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 bg-card border-primary/20 neon-glow relative overflow-hidden flex flex-col justify-center items-center p-8 text-center">
          <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center border-2 border-primary shadow-[0_0_30px_rgba(0,255,255,0.2)] mb-6">
            <Trophy className="w-12 h-12 text-primary" />
          </div>
          <h2 className="text-3xl font-bold">{user?.username}</h2>
          <div className="text-primary font-bold tracking-widest uppercase mt-2">{user?.levelName}</div>
          <div className="mt-6 flex items-center gap-2 text-muted-foreground">
            <span className="font-bold text-foreground text-xl">Lv. {user?.currentLevel}</span>
            <span>•</span>
            <span>{user?.totalPoints} XP Total</span>
          </div>
        </Card>

        <div className="md:col-span-2 grid grid-cols-2 gap-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Flame className="w-4 h-4 text-accent" /> Active Streak
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{user?.streakDays}</div>
              <div className="text-sm text-muted-foreground mt-1">Best: {user?.longestStreak} days</div>
            </CardContent>
          </Card>
          
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Award className="w-4 h-4 text-secondary" /> Badges Earned
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-foreground">{userBadges?.length || 0}</div>
              <div className="text-sm text-muted-foreground mt-1">Keep collecting</div>
            </CardContent>
          </Card>
          
          <Card className="bg-card border-border col-span-2">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-medium text-muted-foreground">Weekly XP Gain</CardTitle>
            </CardHeader>
            <CardContent className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                  <XAxis dataKey="name" stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1A202C', border: '1px solid #00FFFF', borderRadius: '8px' }}
                    itemStyle={{ color: '#00FFFF' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="xp" 
                    stroke="#00FFFF" 
                    strokeWidth={3} 
                    dot={{ fill: '#00FFFF', r: 4 }} 
                    activeDot={{ r: 6, fill: '#00FFFF', stroke: '#1A202C', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2 mb-6">
          <Award className="w-6 h-6 text-secondary" />
          Badges & Achievements
        </h2>
        
        {userBadges && userBadges.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {userBadges.map((ub) => (
              <Card key={ub.badge.id} className="bg-secondary/10 border-secondary/30 flex flex-col items-center p-4 text-center hover:border-secondary transition-colors">
                <div className="w-16 h-16 rounded-full bg-secondary/20 flex items-center justify-center mb-3">
                  <Award className="w-8 h-8 text-secondary" />
                </div>
                <h3 className="font-bold text-sm text-foreground">{ub.badge.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">{ub.badge.description}</p>
                <p className="text-[10px] text-secondary mt-3 uppercase tracking-wider font-bold">
                  {format(new Date(ub.earnedAt), 'MMM d, yyyy')}
                </p>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 border-2 border-dashed border-muted rounded-xl">
            <Award className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No badges yet</h3>
            <p className="text-muted-foreground mt-1">Complete quests to unlock achievements.</p>
          </div>
        )}
      </div>
    </div>
  );
}
