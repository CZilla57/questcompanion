import React, { useState } from 'react';
import { useLocation } from "wouter";
import { Link } from "wouter";
import { Home, CheckSquare, BarChart2, Users, X, Zap, Bell, BellOff, Menu, User, LogOut, Timer, Download, ShoppingBag } from "lucide-react";
import { useGetNudges, useGetBrainState, BrainMode } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { useToast } from "@/hooks/use-toast";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { NAV_GROUPS, activeGroupKey, type NavGroupKey } from "@/lib/nav-groups";
import { shouldShowInstallButton } from "@/lib/pwa";
import { subscribeToast, unsubscribeToast } from "@/lib/push";
import { browserTimeZone } from "@/lib/timezone";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { DopamineOverlay } from "./dopamine-overlay";
import { InstallBanner } from "./install-banner";
import { EmergencyModeProvider } from "./emergency-mode";
import { BrainModeChip } from "./brain-mode-chip";
import { CoinChip } from "./coin-chip";
import { RescueSheet } from "./rescue-sheet";
import { ProtectionPause } from "./protection-pause";
import { NotificationPrefsPanel } from "./notification-prefs";

function NotificationBell() {
  const { state, isSubscribed, supported, subscribe, unsubscribe } = useNotifications();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  if (!supported) return null;

  const handleToggle = async () => {
    setLoading(true);
    try {
      // Map the outcome to a toast so the button always gives feedback — never
      // silently does nothing. (Reading `state` here would be stale after the
      // await; the outcome from the hook is authoritative.)
      const message = isSubscribed
        ? unsubscribeToast(await unsubscribe())
        : subscribeToast(await subscribe());
      if (message) toast(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Notification settings"
                className={`relative ${isSubscribed ? "text-primary" : "text-muted-foreground"}`}
              >
                {isSubscribed ? (
                  <Bell className="w-5 h-5 drop-shadow-[0_0_4px_rgba(0,255,255,0.8)]" />
                ) : (
                  <BellOff className="w-5 h-5" />
                )}
                {isSubscribed && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full" />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Notifications</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" className="w-auto p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">Push notifications</div>
            <div className="text-[11px] text-muted-foreground">
              {state === "denied" ? "Blocked in browser settings" : isSubscribed ? "On for this device" : "Off"}
            </div>
          </div>
          <Switch
            aria-label={isSubscribed ? "Disable notifications" : "Enable notifications"}
            checked={isSubscribed}
            disabled={loading || state === "denied"}
            onCheckedChange={handleToggle}
          />
        </div>
        <NotificationPrefsPanel subscribed={isSubscribed} />
      </PopoverContent>
    </Popover>
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

// Icons stay presentational, keyed by group; config truth lives in nav-groups.ts.
const NAV_ICONS: Record<NavGroupKey, typeof Home> = {
  home: Home, quests: CheckSquare, focus: Timer, progress: BarChart2,
  hero: User, allies: Users, rewards: ShoppingBag,
};
const allNavItems = NAV_GROUPS.map((g) => ({ ...g, icon: NAV_ICONS[g.key] }));
const mobileNavItems = allNavItems.filter((i) => i.mobileShow);

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const activeKey = activeGroupKey(location);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: navNudges } = useGetNudges();
  const allyUnread = (navNudges ?? []).filter((n) => !n.readAt).length;
  const { data: brainState } = useGetBrainState({ tz: browserTimeZone() });

  return (
    <EmergencyModeProvider renderRescue={(task, close, onRejected) => (
      <RescueSheet task={task} open onOpenChange={(o) => { if (!o) close(); }} onRejected={onRejected} />
    )}>
    {/* h-dvh (not min-h-screen): the root must have a *definite* height so the
        flex-1 <main> below actually caps at the viewport and scrolls internally.
        With min-h only, main sized to its content, the document itself scrolled,
        and iOS Safari would leave the fixed bottom nav stranded mid-page during
        momentum scrolls. Definite height ⇒ body never scrolls ⇒ nav can't drift. */}
    <div className="h-dvh bg-background text-foreground flex flex-col md:flex-row overflow-hidden font-sans dark">

      {/* ── Mobile header ─────────────────────────────────── */}
      <header className="md:hidden flex items-center justify-between px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] border-b border-border bg-card/80 backdrop-blur-md z-20 sticky top-0">
        <div className="flex items-center gap-2 text-primary">
          <Zap className="w-5 h-5 fill-current" />
          <span className="font-bold text-base tracking-wider uppercase">FocusQuest</span>
        </div>
        <div className="flex items-center gap-1">
          <CoinChip />
          <BrainModeChip />
          <InstallButton />
          <NotificationBell />
          <TooltipProvider>
            <LogoutButton iconOnly />
          </TooltipProvider>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="relative text-muted-foreground md:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            {allyUnread > 0 && !sidebarOpen && (
              <span aria-hidden className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-destructive rounded-full" />
            )}
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
        {/* Stacked, not a single justify-between row: logo + status controls together
            exceed the w-64 sidebar's inner width, so on one line the chip/bell overflow
            into the main content. Giving the controls their own line keeps each within 208px. */}
        <div className="p-6 hidden md:flex md:flex-col items-start gap-4 mb-8">
          <div className="flex items-center gap-3 text-primary">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <span className="font-bold text-xl tracking-wider uppercase text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
              FocusQuest
            </span>
          </div>
          <div className="flex items-center gap-1 -ml-1">
            <CoinChip />
            <BrainModeChip />
            <InstallButton />
            <NotificationBell />
          </div>
        </div>

        {/* overflow-y-auto: the root is now viewport-height, so on short windows
            the nav list must scroll inside the rail instead of clipping.
            Mobile top margin includes the status-bar inset — the drawer spans the
            full screen under a translucent status bar (viewport-fit=cover). */}
        <nav className="flex-1 px-4 space-y-1 mt-[calc(env(safe-area-inset-top)+2rem)] md:mt-0 overflow-y-auto" aria-label="Main navigation">
          {allNavItems.map((item) => {
            const isActive = activeKey === item.key;
            return (
              <Link
                key={item.key}
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
                    {item.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-2 border-t border-border mt-2">
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
      <main className="flex-1 relative overflow-y-auto overflow-x-hidden overscroll-contain p-4 md:p-8 pb-24 md:pb-8">
        <div className="max-w-5xl mx-auto">
          {brainState?.mode === BrainMode.hyperfocus && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs text-muted-foreground">
              <span>Flow protected — check-in prompts muted. Break when you're ready.</span>
              <ProtectionPause />
            </div>
          )}
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
          const isActive = activeKey === item.key;
          return (
            <Link
              key={item.key}
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
    </EmergencyModeProvider>
  );
}
