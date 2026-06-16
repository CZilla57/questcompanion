import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Plus, Filter, Zap, Info } from "lucide-react";
import { Task, useGetTasks, useCreateTask, TaskPriority } from "@workspace/api-client-react";
import { TaskItem } from "@/components/task-item";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTasksQueryKey } from "@workspace/api-client-react";

interface PointPreview {
  points: number;
  category: string;
  categoryLabel: string;
}

const PRIORITY_LABEL: Record<string, string> = {
  high: "High Priority",
  medium: "Medium Priority",
  low: "Low Priority",
};

function usePointPreview(title: string, priority: string): PointPreview | null {
  const [preview, setPreview] = useState<PointPreview | null>(null);

  useEffect(() => {
    if (!title.trim()) { setPreview(null); return; }
    const timer = setTimeout(() => {
      fetch(`/api/tasks/suggest-points?title=${encodeURIComponent(title)}&priority=${priority}`)
        .then((r) => r.json())
        .then((data: PointPreview) => setPreview(data))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [title, priority]);

  return preview;
}

export default function Tasks() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [filter, setFilter] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDesc, setNewTaskDesc] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<TaskPriority>(TaskPriority.medium);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useGetTasks({
    date: date ? format(date, 'yyyy-MM-dd') : undefined,
    completed: filter === "completed" ? true : filter === "pending" ? false : undefined
  });

  const createMutation = useCreateTask();
  const pointPreview = usePointPreview(newTaskTitle, newTaskPriority);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !date) return;

    createMutation.mutate({
      data: {
        title: newTaskTitle,
        description: newTaskDesc,
        priority: newTaskPriority as any,
        dueDate: format(date, 'yyyy-MM-dd'),
      }
    }, {
      onSuccess: (task) => {
        toast({
          title: `Quest added — ${task.points} XP`,
          description: `Category: ${task.title}`,
          className: "border-primary bg-primary/10",
        });
        setIsCreateOpen(false);
        setNewTaskTitle("");
        setNewTaskDesc("");
        setNewTaskPriority(TaskPriority.medium);
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      }
    });
  };

  const handleClose = () => {
    setIsCreateOpen(false);
    setNewTaskTitle("");
    setNewTaskDesc("");
    setNewTaskPriority(TaskPriority.medium);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Quest Log</h1>
          <p className="text-muted-foreground mt-1">Manage your active and completed objectives.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_15px_rgba(0,255,255,0.3)]">
          <Plus className="w-5 h-5 mr-2" /> New Quest
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-center bg-card p-4 rounded-xl border border-border">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={`w-full sm:w-[240px] justify-start text-left font-normal ${!date && "text-muted-foreground"}`}>
              <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
              {date ? format(date, "PPP") : <span>Pick a date</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 border-primary/20" align="start">
            <Calendar mode="single" selected={date} onSelect={setDate} initialFocus />
          </PopoverContent>
        </Popover>

        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="w-4 h-4 mr-2 text-primary" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Quests</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        {date && (
          <Button variant="ghost" onClick={() => setDate(undefined)} className="w-full sm:w-auto text-muted-foreground">
            Clear Date
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted/20 animate-pulse rounded-xl border border-border" />
          ))
        ) : tasks && tasks.length > 0 ? (
          tasks.map(task => (
            <TaskItem key={task.id} task={task} onEdit={() => {}} />
          ))
        ) : (
          <div className="text-center py-20 border-2 border-dashed border-muted rounded-xl bg-card/50">
            <h3 className="text-xl font-bold text-foreground mb-2">Log is empty</h3>
            <p className="text-muted-foreground">No quests found for the selected filters.</p>
          </div>
        )}
      </div>

      <Dialog open={isCreateOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
        <DialogContent className="sm:max-w-md bg-card border-primary/30">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-primary">New Quest</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateTask} className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Objective</label>
              <Input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="e.g. Morning workout, Read for 20 min..."
                className="border-primary/20 focus:border-primary"
                autoFocus
              />
            </div>

            {/* Live XP Preview */}
            <div className={`rounded-lg border px-4 py-3 transition-all duration-300 ${
              pointPreview
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-muted/20"
            }`}>
              {pointPreview ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-0.5">Auto-assigned XP</div>
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-primary" />
                      <span className="text-2xl font-bold text-primary">{pointPreview.points} XP</span>
                      <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-muted border border-border">
                        {pointPreview.categoryLabel}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Info className="w-3 h-3" />
                      Set by task type
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm">XP auto-assigned when you type your objective</span>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Details (Optional)</label>
              <Textarea
                value={newTaskDesc}
                onChange={(e) => setNewTaskDesc(e.target.value)}
                placeholder="Add some context..."
                className="border-primary/20 focus:border-primary"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground mb-1 block">Priority</label>
              <Select value={newTaskPriority} onValueChange={(val: TaskPriority) => setNewTaskPriority(val)}>
                <SelectTrigger className="border-primary/20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">Priority adjusts XP up or down based on urgency.</p>
            </div>

            <div className="pt-4 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button
                type="submit"
                disabled={!newTaskTitle.trim() || createMutation.isPending}
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {createMutation.isPending ? "Adding..." : "Add to Log"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
