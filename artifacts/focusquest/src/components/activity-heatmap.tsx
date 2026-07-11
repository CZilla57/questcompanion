import { useState, useRef, useEffect, type ReactNode } from "react";
import {
  format,
  subDays,
  startOfWeek,
  addDays,
  getDay,
  isSameDay,
  differenceInCalendarDays,
} from "date-fns";
import {
  useGetCalendarHeatmap,
  useGetTasks,
  type HeatmapDay,
  type Task,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, Check, Circle, Flame } from "lucide-react";

const CELL_SIZE = 12;
const CELL_GAP = 3;
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];
const DAYS_TO_SHOW = 90;

function getColor(day: HeatmapDay | undefined): string {
  if (!day || day.totalTasks === 0) return "hsl(180, 10%, 12%)";
  const ratio = day.completedTasks / day.totalTasks;
  if (ratio === 0) return "hsl(0, 50%, 20%)";
  if (ratio < 0.5) return "hsl(180, 80%, 20%)";
  if (ratio < 1) return "hsl(180, 90%, 35%)";
  return "hsl(180, 100%, 50%)";
}

function getGlow(day: HeatmapDay | undefined): string {
  if (!day || day.totalTasks === 0) return "";
  const ratio = day.completedTasks / day.totalTasks;
  if (ratio === 1) return "drop-shadow-[0_0_4px_rgba(0,255,255,0.6)]";
  return "";
}

function buildGrid(): { dates: Date[]; gridStart: Date } {
  const today = new Date();
  const startRaw = subDays(today, DAYS_TO_SHOW - 1);
  const gridStart = startOfWeek(startRaw, { weekStartsOn: 1 });

  const dates: Date[] = [];
  let current = gridStart;
  while (current <= today) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return { dates, gridStart };
}

function groupByWeek(dates: Date[]): Date[][] {
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];

  for (const date of dates) {
    const dow = getDay(date);
    const mondayBased = dow === 0 ? 6 : dow - 1;
    if (mondayBased === 0 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeek.push(date);
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);
  return weeks;
}

function getMonthLabels(
  weeks: Date[][]
): { label: string; colIndex: number }[] {
  const labels: { label: string; colIndex: number }[] = [];
  let lastMonth = -1;

  weeks.forEach((week, colIndex) => {
    const firstDay = week[0];
    const month = firstDay.getMonth();
    if (month !== lastMonth) {
      labels.push({ label: format(firstDay, "MMM"), colIndex });
      lastMonth = month;
    }
  });
  return labels;
}

function DetailPanelSkeleton() {
  return (
    <div className="animate-pulse space-y-3 pt-4 border-t border-border mt-4">
      <div className="flex items-center justify-between">
        <div className="h-4 w-40 bg-muted rounded" />
        <div className="h-5 w-20 bg-muted rounded-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-8 bg-muted/30 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function DetailPanel({
  date,
  heatmapDay,
}: {
  date: Date;
  heatmapDay: HeatmapDay | undefined;
}) {
  const dateStr = format(date, "yyyy-MM-dd");
  const { data: tasks, isLoading } = useGetTasks({ date: dateStr });

  if (isLoading) return <DetailPanelSkeleton />;

  const pending = tasks?.filter((t: Task) => !t.completed) ?? [];
  const completed = tasks?.filter((t: Task) => t.completed) ?? [];
  const total = (tasks ?? []).length;

  return (
    <div className="pt-4 border-t border-border mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-foreground">
          {format(date, "EEEE, MMM d")}
        </h3>
        <div className="flex items-center gap-3">
          {heatmapDay && heatmapDay.xpEarned > 0 && (
            <span className="text-xs font-bold text-primary flex items-center gap-1">
              <Flame className="w-3 h-3" />
              {heatmapDay.xpEarned} XP
            </span>
          )}
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
            {completed.length}/{total} Quests
          </span>
        </div>
      </div>

      {total === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          No quests scheduled this day.
        </p>
      ) : (
        <div className="space-y-1.5">
          {[...completed, ...pending].map((task: Task) => (
            <div
              key={task.id}
              className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-muted/30 transition-colors"
            >
              {task.completed ? (
                <Check className="w-4 h-4 text-primary flex-shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <span
                className={`text-sm truncate ${task.completed ? "line-through text-muted-foreground" : "text-foreground"}`}
              >
                {task.title}
              </span>
              {task.category && task.category !== "default" && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground flex-shrink-0">
                  {task.categoryLabel ?? task.category}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityHeatmap({ aside }: { aside?: ReactNode } = {}) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { dates, gridStart } = buildGrid();
  const today = new Date();
  const apiDays = differenceInCalendarDays(today, gridStart) + 1;
  const { data, isLoading } = useGetCalendarHeatmap({ days: apiDays });
  const weeks = groupByWeek(dates);
  const monthLabels = getMonthLabels(weeks);

  const dayMap = new Map<string, HeatmapDay>();
  if (data?.days) {
    for (const d of data.days) {
      dayMap.set(d.date, d);
    }
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [isLoading]);

  const handleCellClick = (date: Date) => {
    if (date > today) return;
    setSelectedDate((prev) =>
      prev && isSameDay(prev, date) ? null : date
    );
  };

  const selectedKey = selectedDate
    ? format(selectedDate, "yyyy-MM-dd")
    : null;

  const labelColWidth = 28;
  const gridWidth =
    weeks.length * (CELL_SIZE + CELL_GAP) - CELL_GAP;

  if (isLoading) {
    return (
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            Quest Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col lg:flex-row lg:items-center gap-6">
            <div className="w-full lg:w-[240px] lg:flex-shrink-0">
              <div className="h-[120px] bg-muted/20 animate-pulse rounded-lg" />
            </div>
            {aside && (
              <div className="lg:flex-1 lg:border-l lg:border-border lg:pl-6 pt-4 lg:pt-0 border-t lg:border-t-0 border-border flex items-center justify-center">
                {aside}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <CalendarDays className="w-4 h-4" />
          Quest Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
        <div className="min-w-0 lg:flex-shrink-0">
        <div
          ref={scrollRef}
          className="overflow-x-auto"
        >
          <div
            style={{
              minWidth: labelColWidth + gridWidth,
            }}
          >
            {/* Month labels */}
            <div
              className="flex text-[10px] text-muted-foreground mb-1"
              style={{ paddingLeft: labelColWidth }}
            >
              {weeks.map((week, wi) => {
                const monthLabel = monthLabels.find(
                  (m) => m.colIndex === wi
                );
                return (
                  <div
                    key={wi}
                    style={{
                      width: CELL_SIZE,
                      marginRight: CELL_GAP,
                    }}
                    className="flex-shrink-0 overflow-visible whitespace-nowrap"
                  >
                    {monthLabel?.label ?? ""}
                  </div>
                );
              })}
            </div>

            {/* Grid */}
            <div className="flex gap-0">
              {/* Day labels */}
              <div
                className="flex flex-col justify-between flex-shrink-0 pr-1"
                style={{
                  width: labelColWidth,
                  height: 7 * (CELL_SIZE + CELL_GAP) - CELL_GAP,
                }}
              >
                {DAY_LABELS.map((label, i) => (
                  <span
                    key={i}
                    className="text-[10px] text-muted-foreground leading-none"
                    style={{ height: CELL_SIZE }}
                  >
                    {label}
                  </span>
                ))}
              </div>

              {/* Cells */}
              <div
                className="flex"
                style={{ gap: CELL_GAP }}
              >
                {weeks.map((week, wi) => (
                  <div
                    key={wi}
                    className="flex flex-col"
                    style={{ gap: CELL_GAP }}
                  >
                    {Array.from({ length: 7 }).map((_, dayIndex) => {
                      const date = week[dayIndex];
                      if (!date || date > today) {
                        return (
                          <div
                            key={dayIndex}
                            style={{
                              width: CELL_SIZE,
                              height: CELL_SIZE,
                            }}
                          />
                        );
                      }
                      const key = format(date, "yyyy-MM-dd");
                      const hDay = dayMap.get(key);
                      const isSelected = selectedKey === key;
                      return (
                        <button
                          key={dayIndex}
                          onClick={() => handleCellClick(date)}
                          aria-label={`${format(date, "MMM d")}: ${hDay ? `${hDay.completedTasks}/${hDay.totalTasks} quests` : "no quests"}`}
                          className={`rounded-sm transition-all duration-150 cursor-pointer ${getGlow(hDay)} ${isSelected ? "ring-1 ring-foreground" : "hover:ring-1 hover:ring-muted-foreground"}`}
                          style={{
                            width: CELL_SIZE,
                            height: CELL_SIZE,
                            backgroundColor: getColor(hDay),
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-3 text-[10px] text-muted-foreground">
          <span>Less</span>
          {[
            "hsl(180, 10%, 12%)",
            "hsl(180, 80%, 20%)",
            "hsl(180, 90%, 35%)",
            "hsl(180, 100%, 50%)",
          ].map((color, i) => (
            <div
              key={i}
              className="rounded-sm"
              style={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                backgroundColor: color,
              }}
            />
          ))}
          <span>More</span>
        </div>
        </div>{/* end heatmap column */}

          {aside && (
            <div className="lg:flex-1 lg:border-l lg:border-border lg:pl-6 pt-4 lg:pt-0 mt-1 lg:mt-0 border-t lg:border-t-0 border-border flex items-center justify-center">
              {aside}
            </div>
          )}
        </div>{/* end two-column row */}

        {/* Detail panel */}
        {selectedDate && (
          <DetailPanel
            date={selectedDate}
            heatmapDay={dayMap.get(selectedKey!)}
          />
        )}
      </CardContent>
    </Card>
  );
}
