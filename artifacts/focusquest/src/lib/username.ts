// Shared hero-name rules — OnboardingScreen and the Hero-page rename dialog
// must agree with the server's rename.ts.
export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

export function heroNameError(name: string): string | null {
  const trimmed = name.trim();
  if (USERNAME_REGEX.test(trimmed)) return null;
  if (trimmed.length < 3) return "Hero name must be at least 3 characters.";
  if (trimmed.length > 20) return "Hero name must be 20 characters or fewer.";
  return "Only letters, numbers, and underscores allowed.";
}
