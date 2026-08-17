import type { InitiationXp } from "@workspace/api-client-react";

const KIND_LABELS: Record<string, string> = {
  session_start: "Started",
  first_step: "First step",
  questline_kickoff: "Questline kickoff",
  first_move: "First move today",
};

/**
 * Toast content for an initiation award burst, or null when nothing was
 * awarded. Copy celebrates what happened — never what's left (anti-shame law).
 */
export function initiationToast(
  xp: InitiationXp | undefined | null,
): { title: string; description: string } | null {
  if (!xp || xp.total <= 0) return null;
  return {
    title: `You started — that's the hard part. +${xp.total} XP`,
    description: xp.awards.map((a) => `${KIND_LABELS[a.kind] ?? a.kind} +${a.points}`).join(" · "),
  };
}
