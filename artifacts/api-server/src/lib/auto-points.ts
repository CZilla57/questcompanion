interface RuleEntry {
  keywords: string[];
  basePoints: number;
  category: string;
}

// First matching rule wins, so ORDER MATTERS. Blocks are ordered so specific new
// categories win before broad generics can shadow them: travel precedes deep_work so
// "plan a trip"/"book flight" -> travel; finance precedes errands so "tax return" ->
// finance while "return package" -> errands.
const RULES: RuleEntry[] = [
  // ── Health & Fitness ─────────────────────────────────────────────────────
  { keywords: ["workout", "gym", "lift", "weight", "strength", "resistance"], basePoints: 35, category: "health" },
  { keywords: ["run", "running", "jog", "jogging", "sprint", "5k", "10k", "marathon"], basePoints: 35, category: "health" },
  { keywords: ["swim", "swimming", "bike", "biking", "cycle", "cycling", "hike", "hiking"], basePoints: 30, category: "health" },
  { keywords: ["yoga", "pilates", "stretch", "stretching", "exercise", "cardio", "hiit"], basePoints: 25, category: "health" },
  { keywords: ["walk", "walking", "steps"], basePoints: 15, category: "health" },
  { keywords: ["doctor", "dentist", "therapy", "therapist", "appointment", "checkup", "prescription", "physio", "physical therapy"], basePoints: 25, category: "health" },
  { keywords: ["medication", "medicine", "vitamins", "supplements"], basePoints: 10, category: "health" },
  { keywords: ["sleep", "bed", "wake up", "morning routine", "night routine", "nap"], basePoints: 10, category: "health" },
  { keywords: ["meal prep", "meal plan", "cook", "cooking", "prepare food", "healthy eating", "diet"], basePoints: 20, category: "health" },

  // ── Self-Care ────────────────────────────────────────────────────────────
  { keywords: ["meditat", "mindful", "breathe", "breathing", "relax"], basePoints: 15, category: "self_care" },
  { keywords: ["journal", "journaling", "diary", "reflect", "gratitude"], basePoints: 15, category: "self_care" },
  { keywords: ["self care", "self-care", "skincare", "unwind", "mental health"], basePoints: 15, category: "self_care" },

  // ── Travel ───────────────────────────────────────────────────────────────
  { keywords: ["flight", "flights", "fly", "airport", "boarding pass"], basePoints: 20, category: "travel" },
  { keywords: ["packing", "luggage", "suitcase", "passport", "visa"], basePoints: 20, category: "travel" },
  { keywords: ["itinerary", "hotel", "airbnb", "trip", "vacation", "rental car", "cruise"], basePoints: 20, category: "travel" },

  // ── Deep Work / Focus ────────────────────────────────────────────────────
  { keywords: ["write", "writing", "draft", "essay", "article", "blog", "report", "thesis"], basePoints: 35, category: "deep_work" },
  { keywords: ["code", "coding", "program", "programming", "develop", "development", "debug", "deploy", "refactor", "algorithm", "architecture"], basePoints: 35, category: "deep_work" },
  { keywords: ["design", "prototype", "mockup", "wireframe", "ui", "ux"], basePoints: 30, category: "deep_work" },
  { keywords: ["research", "analyze", "analysis", "study", "investigate", "audit"], basePoints: 30, category: "deep_work" },
  { keywords: ["build", "create", "make", "produce", "launch"], basePoints: 25, category: "deep_work" },
  { keywords: ["plan", "planning", "strategize", "strategy", "roadmap", "outline"], basePoints: 20, category: "deep_work" },
  { keywords: ["present", "presentation", "slides", "pitch"], basePoints: 30, category: "deep_work" },

  // ── Learning ─────────────────────────────────────────────────────────────
  { keywords: ["read", "reading", "book", "chapter", "pages"], basePoints: 20, category: "learning" },
  { keywords: ["course", "lesson", "tutorial", "lecture", "class", "workshop", "train", "training"], basePoints: 25, category: "learning" },
  { keywords: ["learn", "practice", "study", "review", "memorize", "flashcard"], basePoints: 20, category: "learning" },
  { keywords: ["podcast", "documentary", "video", "watch"], basePoints: 10, category: "learning" },

  // ── Finance ──────────────────────────────────────────────────────────────
  { keywords: ["tax", "taxes", "irs", "tax return", "file taxes"], basePoints: 35, category: "finance" },
  { keywords: ["budget", "budgeting", "finances", "financial"], basePoints: 25, category: "finance" },
  { keywords: ["invoice", "billing", "bill", "pay", "payment", "subscription", "refund"], basePoints: 20, category: "finance" },
  { keywords: ["bank", "transfer", "deposit", "invest", "investing", "savings", "insurance", "mortgage"], basePoints: 15, category: "finance" },

  // ── Errands / Shopping ───────────────────────────────────────────────────
  // After finance so "tax return" -> finance; a bare "return" here catches the rest.
  { keywords: ["grocery", "groceries", "shopping", "shop", "errand", "errands"], basePoints: 15, category: "errands" },
  { keywords: ["pick up", "drop off", "post office", "pharmacy", "dry clean"], basePoints: 15, category: "errands" },
  { keywords: ["gas station", "store", "buy", "return", "supplies"], basePoints: 15, category: "errands" },

  // ── Admin / Correspondence ───────────────────────────────────────────────
  { keywords: ["email", "emails", "inbox", "reply", "respond", "message", "messages"], basePoints: 15, category: "admin" },
  { keywords: ["meeting", "standup", "sync", "interview", "conference"], basePoints: 20, category: "admin" },
  { keywords: ["schedule", "scheduling", "calendar", "book", "booking", "appointment"], basePoints: 10, category: "admin" },
  { keywords: ["organize", "sort", "file", "filing", "paperwork", "document", "archive"], basePoints: 15, category: "admin" },
  { keywords: ["renew", "dmv", "cancel", "application", "register"], basePoints: 15, category: "admin" },

  // ── Household ─────────────────────────────────────────────────────────────
  { keywords: ["clean", "cleaning", "tidy", "vacuum", "mop", "sweep", "dust"], basePoints: 20, category: "household" },
  { keywords: ["laundry", "dishes", "wash", "washing", "iron", "ironing", "dishwasher"], basePoints: 15, category: "household" },
  { keywords: ["repair", "fix", "maintenance", "install", "assemble"], basePoints: 25, category: "household" },
  { keywords: ["declutter", "donate", "throw away", "clear out", "trash", "garbage", "recycling"], basePoints: 20, category: "household" },
  { keywords: ["yard", "lawn", "mow", "garden", "water plants"], basePoints: 20, category: "household" },

  // ── Social / Relationships ───────────────────────────────────────────────
  { keywords: ["call friend", "call family", "call mom", "call dad", "catch up"], basePoints: 15, category: "social" },
  { keywords: ["visit", "meet", "hangout", "hang out", "spend time"], basePoints: 15, category: "social" },
  { keywords: ["text", "birthday", "party", "date night", "dinner with"], basePoints: 15, category: "social" },

  // ── Creative ──────────────────────────────────────────────────────────────
  { keywords: ["draw", "drawing", "paint", "painting", "sketch"], basePoints: 20, category: "creative" },
  { keywords: ["music", "practice guitar", "practice piano", "instrument", "compose", "sing"], basePoints: 20, category: "creative" },
  { keywords: ["photo", "photography", "edit photos", "video edit"], basePoints: 20, category: "creative" },
  { keywords: ["craft", "knit", "pottery", "sculpt"], basePoints: 20, category: "creative" },
];

const PRIORITY_MODIFIER: Record<string, number> = {
  high: 10,
  medium: 0,
  low: -5,
};

export const CATEGORY_LABELS: Record<string, string> = {
  health: "Health",
  self_care: "Self-Care",
  deep_work: "Deep Work",
  learning: "Learning",
  finance: "Finance",
  admin: "Admin",
  household: "Household",
  errands: "Errands",
  social: "Social",
  creative: "Creative",
  travel: "Travel",
  default: "General",
};

export const VALID_CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));

export interface AutoPointResult {
  points: number;
  category: string;
  categoryLabel: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// One regex per keyword, compiled once at module load. The boundary is length-tiered:
//   - short keywords (<=4 chars) match as WHOLE words, so common short words don't match
//     shared-prefix false friends: read≠ready, tax≠taxi, plan≠plant, art≠party, bed≠bedroom.
//     Their inflections (running, shopping, reading, ...) are listed explicitly in RULES.
//   - longer keywords keep an OPEN suffix so stems inflect: meditat→meditation,
//     budget→budgeting, journal→journaling, reflect→reflection.
function keywordRegex(kw: string): RegExp {
  const body = escapeRegExp(kw);
  return kw.length <= 4
    ? new RegExp(`\\b${body}\\b`, "i")
    : new RegExp(`\\b${body}`, "i");
}

const COMPILED: { res: RegExp[]; rule: RuleEntry }[] = RULES.map((rule) => ({
  res: rule.keywords.map(keywordRegex),
  rule,
}));

export function assignPoints(title: string, priority: string = "medium"): AutoPointResult {
  const modifier = PRIORITY_MODIFIER[priority] ?? 0;

  for (const { res, rule } of COMPILED) {
    if (res.some((re) => re.test(title))) {
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
