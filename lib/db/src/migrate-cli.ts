// Applies pending migrations against DATABASE_URL. Run via:
//   pnpm --filter @workspace/db migrate
import { runMigrations, packageMigrationsFolder } from "./migrate";

await runMigrations(packageMigrationsFolder);
console.log("✓ migrations up to date");
