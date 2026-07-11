import { CATALOG } from "@/lib/hero/catalog";

export function HeroCredits() {
  const seen = new Set<string>();
  const rows = CATALOG.filter((e) => {
    const key = `${e.author}|${e.license}|${e.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p className="font-medium">
        Character art: Universal LPC Spritesheet (art assets only). Licensed per-asset:
      </p>
      <ul className="space-y-1">
        {rows.map((e, i) => (
          <li key={i}>
            {e.sourceUrl ? (
              <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                {e.author}
              </a>
            ) : (
              <span>{e.author}</span>
            )}{" "}— {e.license}
          </li>
        ))}
      </ul>
    </div>
  );
}
