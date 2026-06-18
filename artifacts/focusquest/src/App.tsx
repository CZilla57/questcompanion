import { useState } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { useAuth } from "@workspace/replit-auth-web";
import { useGetMyStats, useUpdateMe, getGetMyStatsQueryKey } from "@workspace/api-client-react";
import { Swords, Trophy } from "lucide-react";

import Dashboard from "@/pages/dashboard";
import Tasks from "@/pages/tasks";
import Progress from "@/pages/progress";
import Insights from "@/pages/insights";
import Partners from "@/pages/partners";
import Leaderboard from "@/pages/leaderboard";
import Recurring from "@/pages/recurring";
import AvatarPage from "@/pages/avatar";
import DopamineMenu from "@/pages/dopamine-menu";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

function OnboardingScreen() {
  const [heroName, setHeroName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const qc = useQueryClient();
  const updateMe = useUpdateMe();

  const trimmed = heroName.trim();
  const isFormatValid = USERNAME_REGEX.test(trimmed);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setHeroName(e.target.value);
    setValidationError(null);
    setServerError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isFormatValid) {
      setValidationError(
        trimmed.length < 3
          ? "Hero name must be at least 3 characters."
          : trimmed.length > 20
          ? "Hero name must be 20 characters or fewer."
          : "Only letters, numbers, and underscores allowed."
      );
      return;
    }
    try {
      await updateMe.mutateAsync({ data: { username: trimmed } });
      await qc.invalidateQueries({ queryKey: getGetMyStatsQueryKey() });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "That name is already taken. Try another.";
      setServerError(msg.includes("409") || msg.includes("unique") || msg.includes("duplicate")
        ? "That hero name is already taken. Try another."
        : "Something went wrong. Please try again.");
    }
  }

  const showHint = trimmed.length > 0 && !isFormatValid;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mb-4 flex justify-center">
          <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
            <Swords className="w-10 h-10 text-primary drop-shadow-[0_0_8px_rgba(0,255,255,0.6)]" />
          </div>
        </div>
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Choose Your Hero Name</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          This is the name other players will see on the leaderboard. You can't change it later.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2 text-left">
            <input
              type="text"
              value={heroName}
              onChange={handleChange}
              placeholder="HeroName123"
              maxLength={20}
              autoFocus
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {showHint && (
              <p className="text-xs text-muted-foreground">
                3–20 characters, letters, numbers, and underscores only.
              </p>
            )}
            {validationError && (
              <p className="text-xs text-destructive">{validationError}</p>
            )}
            {serverError && (
              <p className="text-xs text-destructive">{serverError}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={updateMe.isPending || trimmed.length === 0}
            className="w-full inline-flex items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateMe.isPending ? "Saving…" : "Enter the Quest"}
          </button>
        </form>
      </div>
    </div>
  );
}

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data: stats, isLoading } = useGetMyStats();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Swords className="w-8 h-8 text-primary animate-pulse mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (!stats?.onboardingComplete) {
    return <OnboardingScreen />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/recurring" component={Recurring} />
        <Route path="/progress" component={Progress} />
        <Route path="/insights" component={Insights} />
        <Route path="/partners" component={Partners} />
        <Route path="/leaderboard" component={Leaderboard} />
        <Route path="/avatar" component={AvatarPage} />
        <Route path="/dopamine-menu" component={DopamineMenu} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, login } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <Swords className="w-8 h-8 text-primary animate-pulse mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">Loading FocusQuest…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center max-w-sm px-6">
          <div className="mb-6 flex justify-center">
            <div className="p-5 rounded-3xl bg-primary/10 border border-primary/20">
              <Trophy className="w-12 h-12 text-primary drop-shadow-[0_0_10px_rgba(0,255,255,0.6)]" />
            </div>
          </div>
          <h1 className="mb-2 text-2xl font-bold tracking-tight">FocusQuest</h1>
          <p className="mb-8 text-muted-foreground">
            Gamified tasks and habits for ADHD. Complete quests, earn XP, and build streaks.
          </p>
          <button
            onClick={login}
            className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors"
          >
            Log in to play
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthGate>
            <OnboardingGate>
              <Router />
            </OnboardingGate>
          </AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
