import React, { useState } from 'react';
import { useLocation } from "wouter";
import { Link } from "wouter";
import { Home, CheckSquare, BarChart2, BarChart3, Users, Trophy, X, Zap, Bell, BellOff, Repeat, Menu, User, LogOut, Coffee, Timer, Download } from "lucide-react";
import { useGetNudges } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { useToast } from "@/hooks/use-toast";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { shouldShowInstallButton } from "@/lib/pwa";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DopamineOverlay } from "./dopamine-overlay";
import { InstallBanner } from "./install-banner";

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
            className: "border-primary",
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
            aria-label={isSubscribed ? "Disable notifications" : "Enable notifications"}
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

function InstallButton() {
  const { canInstall, isIOS, isStandalone, promptInstall } = usePwaInstall();
  const { toast } = useToast();

  if (!shouldShowInstallButton({ isStandalone, canInstall, isIOS })) return null;

  const handleClick = async () => {
    if (isIOS) {
      toast({
        title: "Install FocusQuest",
        description: "Tap the Share icon, then “Add to Home Screen.”",
      });
      return;
    }
    try {
      await promptInstall();
    } catch (err) {
      console.error("PWA install prompt failed", err);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClick}
            aria-label="Install app"
            className="text-muted-foreground"
          >
            <Download className="h-5 w-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Install app</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function LogoutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <form method="POST" action="/api/logout">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="submit"
            variant="ghost"
            size={iconOnly ? "icon" : "sm"}
            aria-label="Sign out"
            className={`text-muted-foreground hover:text-foreground hover:bg-muted ${iconOnly ? "" : "w-full justify-start gap-3 px-4 py-3 rounded-lg border border-transparent"}`}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!iconOnly && <span className="font-medium">Sign out</span>}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={iconOnly ? "bottom" : "right"}>Sign out</TooltipContent>
      </Tooltip>
    </form>
  );
}

// All nav items — sidebar always shows all; mobile bottom bar shows mobileShow:true only
const allNavItems = [
  { href: "/",               label: "Home",       icon: Home,        mobileShow: true },
  { href: "/tasks",          label: "Quests",     icon: CheckSquare, mobileShow: true },
  { href: "/focus",          label: "Focus",      icon: Timer,       mobileShow: true },
  { href: "/recurring",      label: "Recurring",  icon: Repeat,      mobileShow: false },
  { href: "/progress",       label: "Progress",   icon: BarChart2,   mobileShow: true },
  { href: "/insights",       label: "Insights",   icon: BarChart3,   mobileShow: false },
  { href: "/avatar",         label: "Hero",       icon: User,        mobileShow: true },
  { href: "/partners",       label: "Allies",     icon: Users,       mobileShow: true },
  { href: "/leaderboard",    label: "Board",      icon: Trophy,      mobileShow: false },
  { href: "/dopamine-menu",  label: "Rewards",    icon: Coffee,      mobileShow: false },
];
const mobileNavItems = allNavItems.filter(i => i.mobileShow);

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: navNudges } = useGetNudges();
  const allyUnread = (navNudges ?? []).filter((n) => !n.readAt).length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row overflow-hidden font-sans dark">

      {/* ── Mobile header ─────────────────────────────────── */}
      <header className="md:hidden flex items-center justify-between px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] border-b border-border bg-card/80 backdrop-blur-md z-20 sticky top-0">
        <div className="flex items-center gap-2 text-primary">
          <Zap className="w-5 h-5 fill-current" />
          <span className="font-bold text-base tracking-wider uppercase">FocusQuest</span>
        </div>
        <div className="flex items-center gap-1">
          <InstallButton />
          <NotificationBell />
          <TooltipProvider>
            <LogoutButton iconOnly />
          </TooltipProvider>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="text-muted-foreground md:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
        </div>
      </header>

      {/* ── Desktop sidebar ──────────────────────────────── */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-card border-r border-border flex flex-col
        transition-transform duration-300 ease-in-out
        md:relative md:translate-x-0
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="p-6 hidden md:flex items-center justify-between mb-8">
          <div className="flex items-center gap-3 text-primary">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <span className="font-bold text-xl tracking-wider uppercase text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
              FocusQuest
            </span>
          </div>
          <div className="flex items-center gap-1">
            <InstallButton />
            <NotificationBell />
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-8 md:mt-0" aria-label="Main navigation">
          {allNavItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="block relative"
                onClick={() => setSidebarOpen(false)}
              >
                <div className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200
                  ${isActive
                    ? "bg-primary/15 text-primary neon-glow border border-primary/30"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent"}
                `}>
                  <item.icon
                    className={`w-5 h-5 flex-shrink-0 ${isActive ? "drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]" : ""}`}
                  />
                  {item.href === "/partners" && allyUnread > 0 && (
                    <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center">
                      {allyUnread}
                    </span>
                  )}
                  <span className="font-medium">
                    {item.label === "Board" ? "Leaderboard" : item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 pb-6 pt-2 border-t border-border mt-2">
          <TooltipProvider>
            <LogoutButton />
          </TooltipProvider>
        </div>
      </aside>

      {/* ── Sidebar overlay (mobile) ─────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Main content ─────────────────────────────────── */}
      <main className="flex-1 relative overflow-y-auto overflow-x-hidden p-4 md:p-8 pb-24 md:pb-8">
        <div className="max-w-5xl mx-auto">
          <InstallBanner />
          {children}
        </div>
      </main>

      {/* ── Mobile bottom navigation bar ─────────────────── */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-card/95 backdrop-blur-md border-t border-border flex items-stretch safe-bottom"
      >
        {mobileNavItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex-1 relative"
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <div className={`
                flex flex-col items-center justify-center gap-1 py-2 h-full min-h-[56px] transition-colors
                ${isActive ? "text-primary" : "text-muted-foreground"}
              `}>
                <item.icon
                  className={`w-5 h-5 flex-shrink-0 transition-all ${isActive ? "drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]" : ""}`}
                />
                {item.href === "/partners" && allyUnread > 0 && (
                  <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[10px] min-w-4 h-4 px-1 rounded-full flex items-center justify-center">
                    {allyUnread}
                  </span>
                )}
                <span className={`text-[10px] font-medium leading-none tracking-wide ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                  {item.label}
                </span>
              </div>
            </Link>
          );
        })}
      </nav>

      <DopamineOverlay />
    </div>
  );
}
