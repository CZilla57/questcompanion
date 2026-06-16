import { Check, Clock, Edit2, Flame, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { Task, TaskPriority, useCompleteTask, useDeleteTask, useUncompleteTask } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetTasksQueryKey, getGetMyStatsQueryKey } from "@workspace/api-client-react";

interface TaskItemProps {
  task: Task;
  onEdit?: (task: Task) => void;
  onLevelUp?: (result: any) => void;
}

const priorityColors: Record<TaskPriority, string> = {
  [TaskPriority.low]: "bg-green-500/20 text-green-400 border-green-500/30",
  [TaskPriority.medium]: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  [TaskPriority.high]: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function TaskItem({ task, onEdit, onLevelUp }: TaskItemProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const completeMutation = useCompleteTask();
  const uncompleteMutation = useUncompleteTask();
  const deleteMutation = useDeleteTask();

  const handleToggle = () => {
    if (task.completed) {
      uncompleteMutation.mutate({ id: task.id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
        }
      });
    } else {
      completeMutation.mutate({ id: task.id }, {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
          
          toast({
            title: `Quest Completed! +${res.pointsAwarded} XP`,
            description: res.bonusAwarded ? `All-day bonus! +${res.bonusPoints} XP` : task.title,
            className: "border-primary bg-primary/10 text-primary-foreground",
          });

          if (res.leveledUp || (res.newBadges && res.newBadges.length > 0)) {
            onLevelUp?.(res);
          }
        }
      });
    }
  };

  const handleDelete = () => {
    deleteMutation.mutate({ id: task.id }, {
      onSuccess: () => {
        toast({ title: "Quest abandoned", variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: getGetTasksQueryKey() });
      }
    });
  };

  return (
    <div className={`
      relative group flex items-center gap-4 p-4 rounded-xl border transition-all duration-300
      ${task.completed ? "bg-muted/30 border-muted opacity-60" : "bg-card border-border hover:border-primary/50 hover:shadow-[0_0_15px_rgba(0,255,255,0.1)]"}
    `}>
      <button 
        onClick={handleToggle}
        disabled={completeMutation.isPending || uncompleteMutation.isPending}
        className={`
          flex-shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-300
          ${task.completed ? "bg-primary border-primary text-background neon-glow" : "border-muted-foreground/40 hover:border-primary hover:bg-primary/10"}
        `}
      >
        {task.completed && <Check className="w-5 h-5" />}
      </button>

      <div className="flex-1 min-w-0">
        <h4 className={`font-semibold truncate transition-colors ${task.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
          {task.title}
        </h4>
        {task.description && (
          <p className="text-sm text-muted-foreground truncate">{task.description}</p>
        )}
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>{format(new Date(task.dueDate), 'MMM d, yyyy')}</span>
          </div>
          <div className="flex items-center gap-1 text-xs font-bold text-primary">
            <Flame className="w-3 h-3" />
            <span>{task.points} XP</span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-bold ${priorityColors[task.priority]}`}>
            {task.priority}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {onEdit && (
          <Button variant="ghost" size="icon" onClick={() => onEdit(task)}>
            <Edit2 className="w-4 h-4 text-muted-foreground" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="hover:bg-destructive/20 hover:text-destructive" onClick={handleDelete}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
