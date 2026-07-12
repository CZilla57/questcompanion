export const CATEGORIES = [
  { slug: "health",    label: "Health" },
  { slug: "self_care", label: "Self-Care" },
  { slug: "deep_work", label: "Deep Work" },
  { slug: "learning",  label: "Learning" },
  { slug: "finance",   label: "Finance" },
  { slug: "admin",     label: "Admin" },
  { slug: "household", label: "Household" },
  { slug: "errands",   label: "Errands" },
  { slug: "social",    label: "Social" },
  { slug: "creative",  label: "Creative" },
  { slug: "travel",    label: "Travel" },
  { slug: "default",   label: "General" },
] as const;

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

export const CATEGORY_COLORS: Record<string, string> = {
  health:    "text-green-400  bg-green-400/10  border-green-400/30",
  self_care: "text-teal-400  bg-teal-400/10  border-teal-400/30",
  deep_work: "text-blue-400   bg-blue-400/10   border-blue-400/30",
  learning:  "text-purple-400 bg-purple-400/10 border-purple-400/30",
  finance:   "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  admin:     "text-orange-400 bg-orange-400/10 border-orange-400/30",
  household: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
  errands:   "text-lime-400  bg-lime-400/10  border-lime-400/30",
  social:    "text-pink-400   bg-pink-400/10   border-pink-400/30",
  creative:  "text-fuchsia-400 bg-fuchsia-400/10 border-fuchsia-400/30",
  travel:    "text-cyan-400  bg-cyan-400/10  border-cyan-400/30",
  default:   "text-muted-foreground bg-muted/20 border-border",
};

export const CATEGORY_HEX_COLORS: Record<string, string> = {
  health:    "#4ade80",
  self_care: "#2dd4bf",
  deep_work: "#60a5fa",
  learning:  "#c084fc",
  finance:   "#facc15",
  admin:     "#fb923c",
  household: "#34d399",
  errands:   "#a3e635",
  social:    "#f472b6",
  creative:  "#e879f9",
  travel:    "#22d3ee",
  default:   "#a1a1aa",
};

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.label]),
);
