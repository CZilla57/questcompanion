// Logged-out landing page. Rendered by AuthGate in App.tsx when the auth
// verdict is "out" — it is not a wouter route, so any deep link shows it and
// login's returnTo brings the user back. Everything here is static marketing
// copy: no API calls, no game rules (those stay on the server).
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Brain, Check, Coins, Flame, Gift, LifeBuoy, ListPlus,
  Map as MapIcon, ShieldCheck, Sparkles, Swords, Timer, TrendingUp, Trophy, Users,
} from "lucide-react";
import { PixelHero } from "@/components/pixel-hero";
import { HeroCredits } from "@/components/hero-credits";
import type { HeroLook } from "@/lib/hero/types";

const BASE_LOOK: HeroLook = {
  skin: "light", build: "male", hairStyle: "short", hairColor: "brown",
  face: "neutral", beardStyle: "none", beardColor: "black",
  glasses: "none", earrings: "none",
  avatarClass: "fighter", tier: 0, equipped: [],
};

const CARD_HERO: HeroLook = {
  ...BASE_LOOK, avatarClass: "fighter", tier: 1,
  equipped: [
    { slot: "weapon", spriteId: "sword", rarity: "rare" },
    { slot: "helmet", spriteId: "cap", rarity: "common" },
  ],
};

const CLASS_HEROES: { name: string; blurb: string; look: HeroLook }[] = [
  { name: "Fighter", blurb: "Charges straight at the hard stuff.", look: { ...BASE_LOOK, avatarClass: "fighter", tier: 3 } },
  {
    name: "Mage", blurb: "Turns deep focus into raw power.",
    look: { ...BASE_LOOK, avatarClass: "mage", tier: 2, build: "female", hairColor: "black",
      equipped: [{ slot: "weapon", spriteId: "archmage-staff", rarity: "legendary" }] },
  },
  {
    name: "Ranger", blurb: "Picks off quests from afar.",
    look: { ...BASE_LOOK, avatarClass: "ranger", tier: 2, hairColor: "blonde",
      equipped: [{ slot: "weapon", spriteId: "bow", rarity: "epic" }] },
  },
  { name: "Healer", blurb: "Keeps the party — and you — going.", look: { ...BASE_LOOK, avatarClass: "healer", tier: 2, build: "female" } },
];

const SAMPLE_QUESTS = [
  { title: "Reply to that email", xp: 15, done: true },
  { title: "10-minute tidy sprint", xp: 10, done: false },
  { title: "Book the dentist", xp: 20, done: false },
];

const STEPS = [
  {
    icon: ListPlus,
    title: "Drop in your quests",
    body: "Type it the way you'd say it — \"call Mom tomorrow\" — and quick-add turns it into a quest with a due date. Big ones break down into small steps.",
  },
  {
    icon: Swords,
    title: "Finish them, grab the loot",
    body: "Every quest you finish pays out XP and coins right away. Tougher quests pay more, and surprise gear drops keep it interesting.",
  },
  {
    icon: TrendingUp,
    title: "Level up your world",
    body: "Your hero gains levels and gear, and your kingdoms grow from dirt paths into castles. New features unlock as you play, so it's never too much at once.",
  },
];

const FEATURES = [
  { icon: Brain, color: "text-secondary", title: "Brain check-ins", body: "Focused, distracted, frozen, or hyperfocused? Tell it how your brain is doing and your day adjusts." },
  { icon: LifeBuoy, color: "text-accent", title: "Rescue when you're stuck", body: "Too big? Can't start? Overwhelmed? Rescue breaks a quest into first steps or starts a 2-minute micro-start." },
  { icon: Timer, color: "text-primary", title: "Focus sessions", body: "Timed focus sessions, plus body-doubling rooms where you can work next to your allies." },
  { icon: ShieldCheck, color: "text-[hsl(var(--chart-4))]", title: "No-shame streaks", body: "Streak shields cover the rough days. There are no guilt trips and no red overdue walls." },
  { icon: Gift, color: "text-[hsl(var(--chart-5))]", title: "A dopamine menu", body: "Build a menu of small treats you pick, and get one suggested after a quest. Spend your coins on bigger rewards or a mystery box." },
  { icon: Users, color: "text-secondary", title: "Campaigns & party quests", body: "Tell a long goal in chapters, then team up with allies against weekly bosses." },
];

const KINGDOMS = [
  { id: "hearth", name: "Hearth", domain: "Home & errands" },
  { id: "wellspring", name: "Wellspring", domain: "Health & self-care" },
  { id: "forge", name: "Forge", domain: "Work & admin" },
  { id: "athenaeum", name: "Athenaeum", domain: "Learning & creating" },
  { id: "crossroads", name: "Crossroads", domain: "Friends & travel" },
];

/** True once the element comes within `margin` of the viewport; latches so
 *  sprites mount once and stay. Keeps below-the-fold PixelHero canvases (image
 *  loads + render slots) off the logged-out page's first paint. */
function useNearViewport<T extends Element>(margin = "200px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near] as const;
}

function LoginButton({ onLogin, className = "" }: { onLogin: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onLogin}
      className={`group inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-[0_0_24px_hsl(var(--primary)/0.45)] transition-all hover:bg-primary/90 hover:shadow-[0_0_36px_hsl(var(--primary)/0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      Log in to play
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="mx-auto mb-12 max-w-2xl text-center">
      <p className="mb-3 font-mono text-xs font-bold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
      <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-4 text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** The "login area": a mock player card with the real hero sprite and the sign-in button. */
function LoginCard({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-primary/25 via-secondary/20 to-accent/25 blur-2xl" />
      <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card/90 shadow-[0_0_40px_hsl(var(--primary)/0.15)] backdrop-blur">
        <div className="relative h-36 overflow-hidden border-b border-border">
          <img
            src="/kingdoms/scenes/capital/tier-6.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-70 [image-rendering:pixelated]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
          <span className="absolute left-4 top-4 rounded-md border border-primary/40 bg-background/70 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-primary backdrop-blur">
            Player 1
          </span>
        </div>

        <div className="relative -mt-20 flex items-end gap-4 px-6">
          <div className="relative shrink-0 rounded-xl border border-primary/30 bg-background/80 p-1 backdrop-blur">
            <PixelHero look={CARD_HERO} size={112} />
            <span className="landing-float absolute -right-6 -top-2 rounded-full border border-primary/50 bg-background px-2 py-0.5 font-mono text-xs font-bold text-primary neon-text-glow">
              +15 XP
            </span>
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <p className="text-lg font-bold leading-tight">Your Hero</p>
            <p className="text-xs text-muted-foreground">Level 3 · Fighter</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-[62%] rounded-full bg-gradient-to-r from-primary to-secondary shadow-[0_0_10px_hsl(var(--primary)/0.6)]" />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
              <span>248 / 400 XP</span>
              <span className="flex items-center gap-1 text-[hsl(var(--chart-5))]"><Coins className="h-3 w-3" /> 36</span>
            </div>
          </div>
        </div>

        <ul className="mt-5 space-y-2 px-6">
          {SAMPLE_QUESTS.map((q) => (
            <li key={q.title} className="flex items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2 text-sm">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${q.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
              >
                {q.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <span className={`flex-1 truncate ${q.done ? "text-muted-foreground line-through" : ""}`}>{q.title}</span>
              <span className={`font-mono text-xs font-bold ${q.done ? "text-primary" : "text-muted-foreground"}`}>+{q.xp} XP</span>
            </li>
          ))}
        </ul>

        <div className="p-6 pt-5">
          <LoginButton onLogin={onLogin} className="w-full" />
          <p className="mt-3 text-center text-xs text-muted-foreground">
            New here? The same button creates your hero and gives you a few starter quests.
          </p>
        </div>
      </div>
    </div>
  );
}

export function LandingPage({ onLogin }: { onLogin: () => void }) {
  const [heroesRef, heroesNear] = useNearViewport<HTMLDivElement>();
  return (
    // overflow-x-clip, not -hidden: hidden makes this div a scroll container,
    // which silently breaks the sticky header below.
    <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
      {/* Ambient neon backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[900px] landing-grid" />
      <div aria-hidden className="pointer-events-none absolute -left-40 top-20 h-96 w-96 rounded-full bg-primary/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-32 top-72 h-96 w-96 rounded-full bg-secondary/20 blur-3xl" />

      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="#top" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="rounded-lg border border-primary/30 bg-primary/10 p-1.5">
              <Trophy className="h-5 w-5 text-primary drop-shadow-[0_0_8px_rgba(0,255,255,0.6)]" />
            </span>
            FocusQuest
          </a>
          <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <a href="#how-it-works" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#features" className="transition-colors hover:text-foreground">Built for ADHD</a>
            <a href="#kingdoms" className="transition-colors hover:text-foreground">Your world</a>
          </nav>
          <button
            type="button"
            onClick={onLogin}
            className="rounded-lg border border-primary/40 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            Log in
          </button>
        </div>
      </header>

      <main id="top">
        {/* Hero */}
        <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pt-24">
          <div className="text-center lg:text-left">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs font-bold uppercase tracking-widest text-primary">
              <Sparkles className="h-3.5 w-3.5" /> Made for ADHD brains
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Your to-do list,
              <br />
              <span className="bg-gradient-to-r from-primary via-secondary to-accent bg-clip-text text-transparent">
                now an adventure.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground lg:mx-0">
              FocusQuest turns tasks into quests. Finish one and you earn XP and coins, level up your hero, and
              build a kingdom. Small wins finally feel like wins.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              <LoginButton onLogin={onLogin} />
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                See how it works
              </a>
            </div>
            <ul className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-3 text-sm text-muted-foreground lg:justify-start">
              <li className="flex items-center gap-2"><Flame className="h-4 w-4 text-accent" /> Streaks without the shame</li>
              <li className="flex items-center gap-2"><Coins className="h-4 w-4 text-[hsl(var(--chart-5))]" /> Rewards you choose</li>
              <li className="flex items-center gap-2"><MapIcon className="h-4 w-4 text-secondary" /> A world that grows</li>
            </ul>
          </div>

          <div className="mx-auto w-full max-w-md">
            <LoginCard onLogin={onLogin} />
          </div>
        </section>

        {/* Capital growth band */}
        <section aria-label="Your capital grows as you complete quests" className="relative border-y border-border bg-card/40">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-10 sm:px-6 md:grid-cols-2">
            {[
              { tier: 0, label: "Day one" },
              { tier: 11, label: "Many quests later" },
            ].map((s) => (
              <figure key={s.tier} className="overflow-hidden rounded-xl border border-border">
                <img
                  src={`/kingdoms/scenes/capital/tier-${s.tier}.png`}
                  alt={`The capital at ${s.label.toLowerCase()}`}
                  loading="lazy"
                  className="aspect-[1024/192] w-full object-cover [image-rendering:pixelated]"
                />
                <figcaption className="flex items-center justify-between bg-background/60 px-4 py-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  <span>{s.label}</span>
                  <span className="text-primary">Capital · Tier {s.tier}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <SectionHeading
            eyebrow="How it works"
            title="Three steps. Zero spreadsheets."
            sub="No productivity system to learn. You pick the next thing, finish it, and the game handles the rest."
          />
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-card-border bg-card p-6 transition-colors hover:border-primary/40">
                <span className="absolute right-5 top-5 font-mono text-4xl font-bold text-muted/80">0{i + 1}</span>
                <span className="mb-5 inline-flex rounded-xl border border-primary/30 bg-primary/10 p-3">
                  <s.icon className="h-6 w-6 text-primary" />
                </span>
                <h3 className="mb-2 text-lg font-bold">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ADHD features */}
        <section id="features" className="relative scroll-mt-20 border-y border-border bg-card/40 py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Built for ADHD"
              title="Designed for how your brain actually works"
              sub="It meets you where you are today, whether you're focused, frozen, or somewhere in between."
            />
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="rounded-2xl border border-card-border bg-background/60 p-6 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_0_24px_hsl(var(--primary)/0.12)]">
                  <f.icon className={`mb-4 h-7 w-7 ${f.color}`} />
                  <h3 className="mb-2 font-bold">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Heroes */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <SectionHeading
            eyebrow="Your hero"
            title="Pick a class. Earn your gear."
            sub="Your hero levels up as you finish quests, from rags to legendary loot. Their look is yours to choose."
          />
          <div ref={heroesRef} className="grid grid-cols-2 gap-5 md:grid-cols-4">
            {CLASS_HEROES.map((h) => (
              <div key={h.name} className="flex flex-col items-center rounded-2xl border border-card-border bg-card p-5 text-center">
                <div className="mb-4 rounded-xl bg-gradient-to-b from-primary/10 to-transparent p-2">
                  {heroesNear ? <PixelHero look={h.look} size={112} /> : <div className="h-[112px] w-[112px]" />}
                </div>
                <p className="font-bold">{h.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{h.blurb}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Kingdoms */}
        <section id="kingdoms" className="scroll-mt-20 border-t border-border bg-card/40 py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Your world"
              title="Five kingdoms, one balanced life"
              sub="Each kind of quest builds its own kingdom. At a glance you can see what's thriving and what could use some love."
            />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              {KINGDOMS.map((k, i) => (
                <figure
                  key={k.id}
                  className={`group overflow-hidden rounded-xl border border-card-border bg-background ${i === KINGDOMS.length - 1 ? "col-span-2 md:col-span-1" : ""}`}
                >
                  <div className="overflow-hidden">
                    <img
                      src={`/kingdoms/scenes/${k.id}/tier-5.png`}
                      alt={`The ${k.name} kingdom`}
                      loading="lazy"
                      className="aspect-[320/192] w-full object-cover transition-transform duration-500 group-hover:scale-105 [image-rendering:pixelated]"
                    />
                  </div>
                  <figcaption className="px-3 py-2.5">
                    <p className="text-sm font-bold">{k.name}</p>
                    <p className="text-xs text-muted-foreground">{k.domain}</p>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden py-28">
          <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-primary/10 via-secondary/10 to-accent/10" />
          <div className="relative mx-auto max-w-2xl px-4 text-center sm:px-6">
            <Trophy className="mx-auto mb-6 h-12 w-12 text-primary drop-shadow-[0_0_14px_rgba(0,255,255,0.6)]" />
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Your first quest is waiting.</h2>
            <p className="mx-auto mt-4 max-w-md text-muted-foreground">
              Log in, name your hero, and cross off something small. That first +XP feels better than you'd expect.
            </p>
            <LoginButton onLogin={onLogin} className="mt-8" />
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
            <p className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" /> FocusQuest
            </p>
            <p>Gamified tasks and habits for ADHD.</p>
          </div>
          <details className="mt-6 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">Art credits</summary>
            <div className="mt-3">
              <HeroCredits />
            </div>
          </details>
        </div>
      </footer>
    </div>
  );
}
