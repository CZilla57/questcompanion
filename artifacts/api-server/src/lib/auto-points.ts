interface RuleEntry {
  keywords: string[];
  basePoints: number;
  category: string;
}

const RULES: RuleEntry[] = [
  // ── Health & Fitness (high effort, high reward) ──────────────────────────
  {
    keywords: ["workout", "gym", "lift", "weight", "strength", "resistance"],
    basePoints: 35,
    category: "health",
  },
  {
    keywords: ["run", "running", "jog", "jogging", "sprint", "5k", "10k", "marathon"],
    basePoints: 35,
    category: "health",
  },
  {
    keywords: ["swim", "swimming", "bike", "biking", "cycle", "cycling", "hike", "hiking"],
    basePoints: 30,
    category: "health",
  },
  {
    keywords: ["yoga", "pilates", "stretch", "stretching", "exercise", "cardio", "hiit"],
    basePoints: 25,
    category: "health",
  },
  {
    keywords: ["walk", "walking", "steps"],
    basePoints: 15,
    category: "health",
  },
  {
    keywords: ["meditat", "mindful", "breathe", "breathing", "relax", "rest"],
    basePoints: 15,
    category: "health",
  },
  {
    keywords: ["doctor", "dentist", "therapy", "therapist", "appointment", "checkup", "prescription"],
    basePoints: 25,
    category: "health",
  },
  {
    keywords: ["medication", "medicine", "vitamins", "supplements"],
    basePoints: 10,
    category: "health",
  },
  {
    keywords: ["sleep", "bed", "wake up", "morning routine", "night routine"],
    basePoints: 10,
    category: "health",
  },
  {
    keywords: ["meal prep", "meal plan", "cook", "cooking", "prepare food", "healthy eating", "diet"],
    basePoints: 20,
    category: "health",
  },

  // ── Deep Work / Focus Tasks (high concentration) ─────────────────────────
  {
    keywords: ["write", "writing", "draft", "essay", "article", "blog", "report", "thesis"],
    basePoints: 35,
    category: "deep_work",
  },
  {
    keywords: ["code", "coding", "program", "programming", "develop", "development", "debug", "deploy"],
    basePoints: 35,
    category: "deep_work",
  },
  {
    keywords: ["design", "prototype", "mockup", "wireframe", "ui", "ux"],
    basePoints: 30,
    category: "deep_work",
  },
  {
    keywords: ["research", "analyze", "analysis", "study", "investigate", "audit"],
    basePoints: 30,
    category: "deep_work",
  },
  {
    keywords: ["build", "create", "make", "produce", "develop", "launch"],
    basePoints: 25,
    category: "deep_work",
  },
  {
    keywords: ["plan", "planning", "strategize", "strategy", "roadmap", "outline"],
    basePoints: 20,
    category: "deep_work",
  },
  {
    keywords: ["present", "presentation", "slides", "pitch"],
    basePoints: 30,
    category: "deep_work",
  },

  // ── Learning ─────────────────────────────────────────────────────────────
  {
    keywords: ["read", "reading", "book", "chapter", "pages"],
    basePoints: 20,
    category: "learning",
  },
  {
    keywords: ["course", "lesson", "tutorial", "lecture", "class", "workshop", "train", "training"],
    basePoints: 25,
    category: "learning",
  },
  {
    keywords: ["learn", "practice", "study", "review", "memorize", "flashcard"],
    basePoints: 20,
    category: "learning",
  },
  {
    keywords: ["podcast", "documentary", "video", "watch"],
    basePoints: 10,
    category: "learning",
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    keywords: ["tax", "taxes", "irs", "return", "file taxes"],
    basePoints: 35,
    category: "finance",
  },
  {
    keywords: ["budget", "budgeting", "finances", "financial"],
    basePoints: 25,
    category: "finance",
  },
  {
    keywords: ["invoice", "billing", "bill", "pay", "payment", "subscription"],
    basePoints: 20,
    category: "finance",
  },
  {
    keywords: ["bank", "transfer", "deposit", "invest", "investing", "savings"],
    basePoints: 15,
    category: "finance",
  },

  // ── Admin / Correspondence ────────────────────────────────────────────────
  {
    keywords: ["email", "emails", "inbox", "reply", "respond", "message", "messages"],
    basePoints: 15,
    category: "admin",
  },
  {
    keywords: ["meeting", "call", "standup", "sync", "interview", "conference"],
    basePoints: 20,
    category: "admin",
  },
  {
    keywords: ["schedule", "scheduling", "calendar", "book", "booking", "appointment"],
    basePoints: 10,
    category: "admin",
  },
  {
    keywords: ["organize", "sort", "file", "filing", "paperwork", "document", "archive"],
    basePoints: 15,
    category: "admin",
  },

  // ── Household ─────────────────────────────────────────────────────────────
  {
    keywords: ["clean", "cleaning", "tidy", "vacuum", "mop", "sweep", "dust"],
    basePoints: 20,
    category: "household",
  },
  {
    keywords: ["laundry", "dishes", "wash", "washing", "iron", "ironing"],
    basePoints: 15,
    category: "household",
  },
  {
    keywords: ["grocery", "groceries", "shopping", "shop", "errands", "errand"],
    basePoints: 15,
    category: "household",
  },
  {
    keywords: ["repair", "fix", "maintenance", "install", "assemble"],
    basePoints: 25,
    category: "household",
  },
  {
    keywords: ["declutter", "donate", "throw away", "clear out"],
    basePoints: 20,
    category: "household",
  },

  // ── Social / Relationships ────────────────────────────────────────────────
  {
    keywords: ["call friend", "call family", "call mom", "call dad", "catch up"],
    basePoints: 15,
    category: "social",
  },
  {
    keywords: ["visit", "meet", "hangout", "hang out", "spend time"],
    basePoints: 15,
    category: "social",
  },
  {
    keywords: ["journal", "journaling", "diary", "reflect", "reflection"],
    basePoints: 15,
    category: "social",
  },

  // ── Creative ──────────────────────────────────────────────────────────────
  {
    keywords: ["draw", "drawing", "paint", "painting", "sketch", "art"],
    basePoints: 20,
    category: "creative",
  },
  {
    keywords: ["music", "practice guitar", "practice piano", "instrument", "compose", "sing"],
    basePoints: 20,
    category: "creative",
  },
  {
    keywords: ["photo", "photography", "edit photos", "video edit"],
    basePoints: 20,
    category: "creative",
  },
];

const PRIORITY_MODIFIER: Record<string, number> = {
  high: 10,
  medium: 0,
  low: -5,
};

export const CATEGORY_LABELS: Record<string, string> = {
  health: "Health",
  deep_work: "Deep Work",
  learning: "Learning",
  finance: "Finance",
  admin: "Admin",
  household: "Household",
  social: "Social",
  creative: "Creative",
  default: "General",
};

export const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

export interface AutoPointResult {
  points: number;
  category: string;
  categoryLabel: string;
}

export function assignPoints(title: string, priority: string = "medium"): AutoPointResult {
  const lower = title.toLowerCase();
  const modifier = PRIORITY_MODIFIER[priority] ?? 0;

  for (const rule of RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      const raw = rule.basePoints + modifier;
      return {
        points: Math.max(5, Math.min(100, raw)),
        category: rule.category,
        categoryLabel: CATEGORY_LABELS[rule.category] ?? rule.category,
      };
    }
  }

  // Default: no match — use priority-driven baseline
  const defaultBase = priority === "high" ? 25 : priority === "low" ? 10 : 15;
  return {
    points: Math.max(5, Math.min(100, defaultBase + modifier)),
    category: "default",
    categoryLabel: CATEGORY_LABELS.default,
  };
}
