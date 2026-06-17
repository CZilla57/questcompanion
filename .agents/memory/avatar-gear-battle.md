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

## Nav structure
- Desktop sidebar: all 7 items (Home, Quests, Recurring, Progress, Hero, Allies, Board)
- Mobile bottom nav: 5 items with mobileShow:true (Home, Quests, Progress, Hero, Allies)
- Recurring and Board are sidebar-only on mobile (less frequent access)
