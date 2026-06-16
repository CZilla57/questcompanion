import React, { useState } from 'react';
import { useLocation } from "wouter";
import { Link } from "wouter";
import { Home, CheckSquare, BarChart2, Users, Trophy, Menu, X, Zap, Bell, BellOff, Repeat } from "lucide-react";
import { Button } from "./ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function NotificationBell() {
  const { state, isSubscribed, supported, subscribe, unsubscribe } = useNotifications();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  if (!supported) return null;

  const handleToggle = async () => {
    setLoading(true);
    try {
      if (isSubscribed) {
        const ok = await unsubscribe();
        if (ok) toast({ title: "Notifications disabled" });
      } else {
        const ok = await subscribe();
        if (ok) {
          toast({
            title: "Notifications enabled",
            description: "You'll be reminded about due tasks and streaks.",
            className: "border-primary bg-primary/10",
          });
        } else if (state === "denied") {
          toast({
            title: "Notifications blocked",
            description: "Enable notifications in your browser settings.",
            variant: "destructive",
          });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggle}
            disabled={loading || state === "denied"}
            className={`relative ${isSubscribed ? "text-primary" : "text-muted-foreground"}`}
          >
            {isSubscribed ? (
              <Bell className={`w-5 h-5 ${isSubscribed ? "drop-shadow-[0_0_4px_rgba(0,255,255,0.8)]" : ""}`} />
            ) : (
              <BellOff className="w-5 h-5" />
            )}
            {isSubscribed && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {state === "denied"
            ? "Notifications blocked in browser settings"
            : isSubscribed
            ? "Notifications on — click to disable"
            : "Enable task reminders and streak alerts"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/tasks", label: "Quests", icon: CheckSquare },
    { href: "/recurring", label: "Recurring", icon: Repeat },
    { href: "/progress", label: "Progress", icon: BarChart2 },
    { href: "/partners", label: "Allies", icon: Users },
    { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row overflow-hidden font-sans dark">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card/80 backdrop-blur-md z-20">
        <div className="flex items-center gap-2 text-primary">
          <Zap className="w-6 h-6 fill-current" />
          <span className="font-bold text-lg tracking-wider uppercase">FocusQuest</span>
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </Button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-card border-r border-border flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="p-6 hidden md:flex items-center justify-between mb-8">
          <div className="flex items-center gap-3 text-primary">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <span className="font-bold text-xl tracking-wider uppercase text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">FocusQuest</span>
          </div>
          <NotificationBell />
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-8 md:mt-0">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="block" onClick={() => setSidebarOpen(false)}>
                <div className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200
                  ${isActive
                    ? "bg-primary/15 text-primary neon-glow border border-primary/30"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"}
                `}>
                  <item.icon className={`w-5 h-5 ${isActive ? "drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]" : ""}`} />
                  <span className="font-medium">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Notification hint at bottom of sidebar */}
        <div className="p-4 m-4 rounded-lg border border-border bg-muted/20 hidden md:block">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Reminders</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Daily check-ins at 8am, noon, and 7pm. Streak alerts at 9pm.
          </p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 relative overflow-y-auto overflow-x-hidden p-4 md:p-8">
        <div className="max-w-5xl mx-auto pb-20">
          {children}
        </div>
      </main>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
