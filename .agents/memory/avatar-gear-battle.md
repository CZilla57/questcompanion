---
name: Avatar/Gear/Battle feature
description: Schema decisions and formulas for the avatar customization, gear shop, and weekly battle system.
---

## Tables
- `gear_items` — static catalog, 20 items seeded via SQL (5 slots × 4 rarities)
- `user_gear` — ownership + equipped flag; UNIQUE(user_id, gear_item_id)
- `weekly_battles` — one row per user per week; UNIQUE(user_id, week_key)
- `users.avatar_class` — text column added via ALTER TABLE

## Battle power formula
`power = 30 + level * 5 + sum(equipped gear stat_power)`

## Boss power formula
`boss = min(90 + (iso_week_number - 1) * 70, 750)`
Week key format: "YYYY-WNN" from ISO week calc.

## Battle outcome
Roll = random(power * 0.75 … power * 1.25). Win if roll >= boss.
Win: +500 XP. Lose: +75 XP consolation. One entry per week (UNIQUE constraint enforces it).

## XP at purchase
XP is deducted from totalPoints at buy time (not at equip). Level recalculated immediately.
Activity log entry written with negative points to record the spend.

**Why:** Equipping is free/reversible; purchase is the permanent XP commitment.

## Free gear rewards for streak milestones
Implemented in `artifacts/api-server/src/lib/gear-rewards.ts`.

### Account streak milestones (3, 7, 14, 30, every-30 days)
- Rarity = `getStreakGearRarity(streak, isHighValue)` where isHighValue = task.points >= 50
- 3d→common, 7d→common (high-val→rare), 14d→rare, 30d→rare (high-val→epic), 60d→epic, 100d→legendary

### Habit streak milestones (totalCompletions 5, 15, 30, 60, 100, then every 50)
- Rarity = `getHabitGearRarity(totalCompletions)`: 5→common, 15→rare, 60→epic, 100→legendary

### Selection logic
- Items must be unowned + `level_required <= userLevel`
- Prefer slots the user has no owned gear in (fill empty slots first)
- Fallback chain: legendary → epic → rare → common
- Returns null if all qualifying items already owned

### Response / UI
- `gearReward: GearRewardInfo | null` added to `TaskCompletionResult` in OpenAPI spec
- If both account-streak and habit-streak gear fire on same completion, best rarity is returned
- Frontend shows rarity-styled toast (amber=legendary, violet=epic, blue=rare, slate=common)
- Gear is awarded to inventory but NOT auto-equipped (user goes to Hero page)
- Gear rewards are NOT reversed on task uncomplete

**Why:** Gear is a permanent motivational reward; reversing it on uncomplete would undermine the incentive.

## Nav structure
- Desktop sidebar: all 7 items (Home, Quests, Recurring, Progress, Hero, Allies, Board)
- Mobile bottom nav: 5 items with mobileShow:true (Home, Quests, Progress, Hero, Allies)
- Recurring and Board are sidebar-only on mobile (less frequent access)
