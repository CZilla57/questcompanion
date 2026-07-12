import { describe, it, expect } from "vitest";
import { assignPoints, CATEGORY_LABELS, VALID_CATEGORIES, MORNING_FOCUS_CATEGORIES, EVENING_WINDDOWN_CATEGORIES } from "./auto-points";

const cat = (title: string) => assignPoints(title).category;

describe("assignPoints — precision (word boundary, no mid-word matches)", () => {
  it("does not match short keywords inside other words", () => {
    expect(cat("brunch with friends")).not.toBe("health");     // 'run'
    expect(cat("start the project")).not.toBe("creative");     // 'art'
    expect(cat("attend the workshop")).not.toBe("errands");    // 'shop'
    expect(cat("buy fresh bread")).toBe("errands");            // 'buy' wins, not 'read'
    expect(cat("get ready for work")).not.toBe("learning");    // 'read' ≠ 'ready'
    expect(cat("book a taxi")).not.toBe("finance");            // 'tax' ≠ 'taxi'
    expect(cat("water the plant")).not.toBe("deep_work");      // 'plan' ≠ 'plant'
  });

  it("still matches whole short words and their listed inflections", () => {
    expect(cat("go for a run")).toBe("health");                // 'run' whole word
    expect(cat("go running")).toBe("health");                  // 'running' listed
    expect(cat("reading a chapter")).toBe("learning");         // 'reading' listed
  });

  it("still matches long stems with open suffix", () => {
    expect(cat("morning meditation")).toBe("self_care");       // 'meditat'
    expect(cat("budgeting for the month")).toBe("finance");    // 'budget'
    expect(cat("packing my suitcase")).toBe("travel");         // 'packing'
  });
});

describe("assignPoints — targeted routing fixes", () => {
  it("routes phone calls to social now that admin no longer keys on 'call'", () => {
    expect(cat("call mom")).toBe("social");
    expect(cat("call a friend to catch up")).toBe("social");
  });

  it("splits 'return' between finance (tax) and errands (package)", () => {
    expect(cat("file my tax return")).toBe("finance");
    expect(cat("return package to post office")).toBe("errands");
  });

  it("routes 'book flight' to travel, not learning/admin", () => {
    expect(cat("book flight to NYC")).toBe("travel");
  });

  it("moves journaling out of social into self_care", () => {
    expect(cat("journal for 10 minutes")).toBe("self_care");
  });
});

describe("assignPoints — new category coverage", () => {
  it("categorizes self_care, errands, travel", () => {
    expect(cat("evening skincare routine")).toBe("self_care");
    expect(cat("grocery shopping")).toBe("errands");
    expect(cat("check my itinerary")).toBe("travel");
  });
});

describe("assignPoints — labels + valid set", () => {
  it("exposes labels and valid-category membership for new slugs", () => {
    expect(CATEGORY_LABELS.self_care).toBe("Self-Care");
    expect(CATEGORY_LABELS.errands).toBe("Errands");
    expect(CATEGORY_LABELS.travel).toBe("Travel");
    for (const slug of ["self_care", "errands", "travel"]) {
      expect(VALID_CATEGORIES.has(slug)).toBe(true);
    }
  });
});

describe("time-of-day recommendation categories", () => {
  it("evening wind-down includes the new categories but not travel", () => {
    expect(EVENING_WINDDOWN_CATEGORIES.has("self_care")).toBe(true);
    expect(EVENING_WINDDOWN_CATEGORIES.has("errands")).toBe(true);
    expect(EVENING_WINDDOWN_CATEGORIES.has("household")).toBe(true);
    expect(EVENING_WINDDOWN_CATEGORIES.has("travel")).toBe(false);
  });

  it("morning focus stays limited to health and deep_work", () => {
    expect(MORNING_FOCUS_CATEGORIES.has("health")).toBe(true);
    expect(MORNING_FOCUS_CATEGORIES.has("deep_work")).toBe(true);
    expect(MORNING_FOCUS_CATEGORIES.has("self_care")).toBe(false);
  });
});

describe("assignPoints — regression (starter-quest routing preserved)", () => {
  it("keeps the four seed titles on distinct categories", () => {
    expect(cat("Take a 10-minute walk")).toBe("health");
    expect(cat("Read for 15 minutes")).toBe("learning");
    expect(cat("Tidy up your desk")).toBe("household");
    expect(cat("Plan your top 3 tasks for today")).toBe("deep_work");
  });

  it("still applies priority modifiers and clamps points", () => {
    expect(assignPoints("go running", "high").points).toBe(45);   // 35 + 10
    expect(assignPoints("random task", "low").points).toBe(5);    // 10 - 5, clamped to 5
  });
});
