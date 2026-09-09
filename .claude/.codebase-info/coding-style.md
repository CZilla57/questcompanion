# Coding Style

*Last Updated: 2026-09-08*

## Tooling

- **No linter is configured.** There is no `.eslintrc*`, `biome.json`, or equivalent anywhere in the repo (verified by search).
- **No formatter config either.** `prettier` (`^3.8.3`) is a root `devDependency`, but there is no `.prettierrc*` file — it would run with defaults only, and nothing in `package.json` scripts or CI invokes it. Style consistency today is by convention/review, not tooling.
- **TypeScript strictness is the main enforced bar.** `tsconfig.base.json` (extended by every TS package) sets: `strictNullChecks: true`, `strictBindCallApply: true`, `strictPropertyInitialization: true`, `noImplicitAny: true`, `noImplicitThis: true`, `alwaysStrict: true`, `noImplicitReturns: true`, `noFallthroughCasesInSwitch: true`, `useUnknownInCatchVariables: true`; but `strictFunctionTypes: false` and `noUnusedLocals: false`. `pnpm run typecheck` (root) is the CI gate (`.github/workflows/ci.yml`), not a lint step.
- **`.gitattributes`** normalizes all text to LF (`* text=auto eol=lf`) — this exists specifically because CRLF churn was showing up in generated files like `lib/api-zod/src/generated/**`; if you see line-ending diffs there, check this file before assuming a real change.

## Conventions

| Kind | Convention | Example |
|------|------------|---------|
| TS files | kebab-case | `feature-gates.ts`, `world-boss.ts`, `notification-envelope.ts` |
| Co-located tests | `<module>.test.ts` next to the module | `roll-engine.ts` + `roll-engine.test.ts` |
| Drizzle table objects | `<name>Table` (camelCase, `Table` suffix) | `usersTable`, `personalEncountersTable`, `partyEncounterContributionsTable` |
| Drizzle inferred types | PascalCase, singular | `type User = typeof usersTable.$inferSelect` |
| Insert schemas | `insert<Entity>Schema` (drizzle-zod) | `insertUserSchema`, `insertTaskSchema`, `insertCampaignSchema` |
| React Query generated hooks | `use<Verb><Entity>` | `useGetMyStats`, `useAttuneGear`, `useEnterBattle` |
| Query key helpers | `get<Hook>QueryKey()` | `getGetMyStatsQueryKey()` |
| React components/pages | kebab-case file, PascalCase export | `capital-card.tsx` exports `CapitalCard` |
| Swift files/types | PascalCase, `View`/`ViewModel`/`Manager`/`Service` suffix by role | `HeroView.swift`, `FocusViewModel.swift`, `AuthManager.swift`, `QuestService.swift` |
| DB columns (SQL) | snake_case, mapped from camelCase TS field names | `bond_quests_completed` ← `bondQuestsCompleted` |
| Env vars | SCREAMING_SNAKE_CASE | `DATABASE_URL`, `CRON_SECRET`, `GEMINI_MODEL` |
| Migration files | zero-padded sequence + generated slug | `0016_true_pandemic.sql` |

## Notes

- **Inline comments double as design-decision history.** Schema and lib files are heavily commented with *why*, not just *what* — e.g. `lib/db/src/schema/users.ts` labels column groups by the "Act" that introduced them and states the invariant they protect ("NEVER decremented (anti-shame)", "derived at read time, no cron sweep"). When modifying a column/function with such a comment, preserve or update the invariant it documents rather than deleting the comment.
- **No abstraction layer between routes/components and the ORM/API client** — routes call `@workspace/db` directly; React components call generated React Query hooks directly. Don't introduce a repository/service/store layer without a strong reason; it would be inconsistent with everything else in the codebase.
- **Prefer extending an existing pure `lib/*.ts` module and its test file** over creating a new one when the concept is closely related (e.g. loot tables explicitly reuse `roll-engine.ts`'s PRNG rather than adding a second one — see the `2026-09-07-loot-tables.md` plan). Grep for a similarly-named `lib/` file before adding new game-mechanic logic.
- **"Server-first" ordering for new features**: land the mechanic in `artifacts/api-server`, update `lib/api-spec/openapi.yaml`, regenerate clients, *then* build the UI — this order is explicit in every recent plan doc under `docs/superpowers/plans/`.
