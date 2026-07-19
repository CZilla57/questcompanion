import { useState, useMemo } from "react";
import { useGetMyInsights } from "@workspace/api-client-react";
import { browserTimeZone } from "@/lib/timezone";
import type { InsightsCategoryBreakdown, InsightsDowStat, InsightsPeriodStat, InsightsXpPoint } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RhythmsCard } from "@/components/rhythms-card";
import { WeeklyRecapsSection } from "@/components/weekly-recaps";
import { KingdomMap } from "@/components/kingdom-map";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ResponsiveContainer, Cell, AreaChart, Area,
} from "recharts";
import {
  TrendingUp, Zap, Calendar, Clock, Target, Trophy,
  Flame, BarChart3, Sun, Sunset, Moon, Sunrise,
} from "lucide-react";
import { CATEGORY_HEX_COLORS } from "@/lib/categories";

const TIME_RANGES = [
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
] as const;

const PERIOD_ICONS: Record<string, React.ReactNode> = {
  morning:   <Sunrise className="w-4 h-4" />,
  afternoon: <Sun className="w-4 h-4" />,
  evening:   <Sunset className="w-4 h-4" />,
  night:     <Moon className="w-4 h-4" />,
};

const PERIOD_COLORS: Record<string, string> = {
  morning:   "#fbbf24",
  afternoon: "#f97316",
  evening:   "#818cf8",
  night:     "#6366f1",
};

function completionRate(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: { value: number; name?: string; payload?: Record<string, unknown> }[];
  label?: string;
  unit?: string;
  color?: string;
}

function ChartTooltip({ active, payload, label, unit = "", color = "#00FFFF" }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-primary/30 rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="text-muted-foreground text-xs mb-1">{label}</p>
      <p className="font-bold" style={{ color }}>{payload[0]!.value}{unit}</p>
    </div>
  );
}

function RateTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as unknown as InsightsDowStat;
  const rate = completionRate(p?.completed ?? 0, p?.total ?? 0);
  return (
    <div className="bg-card border border-primary/30 rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="text-muted-foreground text-xs mb-1">{label}</p>
      <p className="font-bold text-primary">{rate}% completion</p>
      <p className="text-xs text-muted-foreground">{p?.completed ?? 0} / {p?.total ?? 0} tasks</p>
    </div>
  );
}

function InsightCard({
  icon,
  title,
  value,
  detail,
  color = "text-primary",
  bg = "bg-primary/10",
  border = "border-primary/30",
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
  color?: string;
  bg?: string;
  border?: string;
}) {
  return (
    <Card className={`bg-card ${border} border`}>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`${bg} ${color} rounded-lg p-2.5 flex-shrink-0 mt-0.5`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{title}</p>
          <p className={`text-xl font-bold mt-0.5 ${color}`}>{value}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function XpTimelineChart({ data, days }: { data: InsightsXpPoint[]; days: number }) {
  const maxXp = Math.max(...data.map(d => d.xp), 1);

  const tickInterval = days <= 30 ? 3 : days <= 60 ? 6 : 9;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="xpGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00FFFF" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#00FFFF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
        <XAxis
          dataKey="label"
          stroke="#A0AEC0"
          fontSize={10}
          tickLine={false}
          axisLine={false}
          interval={tickInterval}
        />
        <YAxis stroke="#A0AEC0" fontSize={10} tickLine={false} axisLine={false} />
        <ReTooltip
          content={({ active, payload, label }) => (
            <ChartTooltip active={active} payload={payload as ChartTooltipProps["payload"]} label={label} unit=" XP" />
          )}
          cursor={{ stroke: "rgba(0,255,255,0.15)", strokeWidth: 1, fill: "rgba(0,255,255,0.03)" }}
        />
        <Area
          type="monotone"
          dataKey="xp"
          stroke="#00FFFF"
          strokeWidth={2}
          fill="url(#xpGradient)"
          dot={(props) => {
            const { cx, cy, payload } = props as { cx: number; cy: number; payload: InsightsXpPoint };
            if (!payload.xp) return <g key={`dot-${payload.date}`} />;
            const isMax = payload.xp === maxXp;
            return (
              <circle
                key={`dot-${payload.date}`}
                cx={cx}
                cy={cy}
                r={isMax ? 4 : 2}
                fill={isMax ? "#00FFFF" : "rgba(0,255,255,0.5)"}
                stroke="none"
              />
            );
          }}
          activeDot={{ r: 5, fill: "#00FFFF", strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function CategoryChart({ data }: { data: InsightsCategoryBreakdown[] }) {
  const chartData = data.map(d => ({
    ...d,
    rate: completionRate(d.completed, d.total),
    fill: CATEGORY_HEX_COLORS[d.category] ?? CATEGORY_HEX_COLORS.default,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 8, left: 4, bottom: 0 }} barSize={14}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" horizontal={false} />
        <XAxis type="number" stroke="#A0AEC0" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
        <YAxis type="category" dataKey="label" stroke="#A0AEC0" fontSize={11} tickLine={false} axisLine={false} width={72} />
        <ReTooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0]!.payload as typeof chartData[number];
            return (
              <div className="bg-card border border-primary/30 rounded-lg px-3 py-2 shadow-lg text-sm">
                <p className="text-muted-foreground text-xs mb-1">{label}</p>
                <p className="font-bold" style={{ color: d.fill }}>{d.rate}% completion rate</p>
                <p className="text-xs text-muted-foreground">{d.completed} / {d.total} tasks · {d.xpEarned} XP earned</p>
              </div>
            );
          }}
          cursor={{ fill: "rgba(255,255,255,0.03)" }}
        />
        <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
          {chartData.map((entry) => (
            <Cell key={entry.category} fill={entry.fill} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DowChart({ data }: { data: InsightsDowStat[] }) {
  const chartData = data.map(d => ({
    ...d,
    rate: completionRate(d.completed, d.total),
  }));
  const maxRate = Math.max(...chartData.map(d => d.rate), 1);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} barSize={28} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
        <XAxis dataKey="label" stroke="#A0AEC0" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke="#A0AEC0" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={v => `${v}%`} />
        <ReTooltip content={<RateTooltip />} cursor={{ fill: "rgba(0,255,255,0.05)" }} />
        <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
          {chartData.map((entry) => (
            <Cell
              key={entry.day}
              fill={entry.rate === maxRate && entry.rate > 0 ? "#00FFFF" : "rgba(0,255,255,0.35)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PeriodChart({ data }: { data: InsightsPeriodStat[] }) {
  const maxCompleted = Math.max(...data.map(d => d.completed), 1);

  return (
    <div className="grid grid-cols-4 gap-3 h-full">
      {data.map((p) => {
        const pct = maxCompleted > 0 ? Math.round((p.completed / maxCompleted) * 100) : 0;
        const color = PERIOD_COLORS[p.key] ?? "#94a3b8";
        const icon = PERIOD_ICONS[p.key];
        const isTop = p.completed === maxCompleted && p.completed > 0;
        return (
          <div key={p.key} className="flex flex-col items-center h-full min-w-0">
            <div className="text-sm font-bold text-foreground mb-1">{p.completed}</div>
            {/* Bar grows from the bottom of the flexible middle area, so its
                height is a share of the space left after the count and labels —
                it can never push them out of the card. */}
            <div className="flex-1 w-full flex items-end min-h-0">
              <div
                className="w-full rounded-t-lg transition-all duration-700"
                style={{
                  height: `${Math.max(4, pct)}%`,
                  background: color,
                  opacity: isTop ? 1 : 0.45,
                  boxShadow: isTop ? `0 0 12px ${color}88` : "none",
                }}
              />
            </div>
            <div className="flex flex-col items-center gap-0.5 mt-2 text-center" style={{ color: isTop ? color : "#A0AEC0" }}>
              {icon}
              <span className="text-xs font-semibold leading-tight">{p.label}</span>
              <span className="text-[10px] text-muted-foreground leading-tight whitespace-nowrap">{p.range}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Insights() {
  const [days, setDays] = useState<30 | 60 | 90>(30);
  const { data, isLoading } = useGetMyInsights({ days, tz: browserTimeZone() });

  const insights = useMemo(() => {
    if (!data) return [];
    const cards = [];

    const totalCompleted = data.categoryBreakdown.reduce((s, c) => s + c.completed, 0);
    const totalTasks     = data.categoryBreakdown.reduce((s, c) => s + c.total, 0);
    const overallRate    = completionRate(totalCompleted, totalTasks);
    const activeDays     = data.xpHistory.filter(d => d.xp > 0).length;
    const avgXp          = activeDays > 0
      ? Math.round(data.xpHistory.reduce((s, d) => s + d.xp, 0) / activeDays)
      : 0;

    const bestDow = [...data.dayOfWeekStats]
      .filter(d => d.total >= 2)
      .sort((a, b) => completionRate(b.completed, b.total) - completionRate(a.completed, a.total))[0];

    const bestPeriod = [...data.periodStats]
      .sort((a, b) => b.completed - a.completed)[0];

    const topCat = data.categoryBreakdown[0];

    cards.push({
      icon: <Target className="w-4 h-4" />,
      title: "Overall Completion",
      value: `${overallRate}%`,
      detail: `${totalCompleted} of ${totalTasks} quests completed in the last ${days} days`,
      color: "text-primary",
      bg: "bg-primary/10",
      border: "border-primary/30",
    });

    if (bestDow) {
      const rate = completionRate(bestDow.completed, bestDow.total);
      cards.push({
        icon: <Calendar className="w-4 h-4" />,
        title: "Best Day of Week",
        value: bestDow.label,
        detail: `${rate}% completion rate on ${bestDow.label}s — your strongest day`,
        color: "text-yellow-400",
        bg: "bg-yellow-400/10",
        border: "border-yellow-400/30",
      });
    }

    if (bestPeriod && bestPeriod.completed > 0) {
      cards.push({
        icon: <Clock className="w-4 h-4" />,
        title: "Peak Productivity",
        value: bestPeriod.label,
        detail: `${bestPeriod.completed} quests completed in the ${bestPeriod.range} window`,
        color: "text-orange-400",
        bg: "bg-orange-400/10",
        border: "border-orange-400/30",
      });
    }

    if (topCat) {
      cards.push({
        icon: <Trophy className="w-4 h-4" />,
        title: "Top Quest Category",
        value: topCat.label,
        detail: `${topCat.completed} completed · ${topCat.xpEarned} XP earned`,
        color: "text-purple-400",
        bg: "bg-purple-400/10",
        border: "border-purple-400/30",
      });
    }

    cards.push({
      icon: <Zap className="w-4 h-4" />,
      title: "Avg XP on Active Days",
      value: `${avgXp} XP`,
      detail: `Active on ${activeDays} of ${days} days — keep those streaks going`,
      color: "text-green-400",
      bg: "bg-green-400/10",
      border: "border-green-400/30",
    });

    return cards;
  }, [data, days]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Zap className="w-8 h-8 text-primary animate-pulse" />
      </div>
    );
  }

  const isEmpty = !data || data.categoryBreakdown.length === 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <RhythmsCard />
      <WeeklyRecapsSection />
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <BarChart3 className="w-7 h-7 text-primary drop-shadow-[0_0_8px_rgba(0,255,255,0.6)]" />
            Insights
          </h1>
          <p className="text-muted-foreground mt-1">Understand your patterns and optimize your flow.</p>
        </div>
        <div className="flex bg-muted/50 rounded-lg p-1 gap-1 self-start">
          {TIME_RANGES.map(({ label, days: d }) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-4 py-1.5 rounded-md text-sm font-semibold transition-all duration-200 ${
                days === d
                  ? "bg-primary text-primary-foreground shadow-[0_0_8px_rgba(0,255,255,0.4)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isEmpty ? (
        <div className="text-center py-24 border-2 border-dashed border-muted rounded-xl">
          <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-foreground">No data yet</h3>
          <p className="text-muted-foreground mt-1">Complete some quests to see your patterns here.</p>
        </div>
      ) : (
        <>
          {/* Insight cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {insights.map((card, i) => (
              <InsightCard key={i} {...card} />
            ))}
          </div>

          {/* XP Timeline */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                XP Earned — Last {days} Days
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[220px] pt-2 pr-2">
              <XpTimelineChart data={data.xpHistory} days={days} />
            </CardContent>
          </Card>

          {/* Kingdom map */}
          <KingdomMap />

          {/* Category + Day-of-week */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Category breakdown */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Completion Rate by Category
                </CardTitle>
              </CardHeader>
              <CardContent
                className="pt-2 pr-2"
                style={{ height: `${Math.max(180, data.categoryBreakdown.length * 36 + 24)}px` }}
              >
                <CategoryChart data={data.categoryBreakdown} />
              </CardContent>
            </Card>

            {/* Day of week */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-primary" />
                  Completion Rate by Day of Week
                </CardTitle>
              </CardHeader>
              <CardContent className="h-[220px] pt-2 pr-2">
                <DowChart data={data.dayOfWeekStats} />
              </CardContent>
            </Card>
          </div>

          {/* Time of day */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Best Time of Day
                <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground/60">
                  (based on when you complete quests)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="h-[220px] px-6 pb-4 pt-3">
              <PeriodChart data={data.periodStats} />
            </CardContent>
          </Card>

          {/* Category legend */}
          {data.categoryBreakdown.length > 0 && (
            <div className="flex flex-wrap gap-3 pb-2">
              {data.categoryBreakdown.map(c => (
                <div key={c.category} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: CATEGORY_HEX_COLORS[c.category] ?? CATEGORY_HEX_COLORS.default }}
                  />
                  {c.label}
                  <span className="text-muted-foreground/50">({c.xpEarned} XP)</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
