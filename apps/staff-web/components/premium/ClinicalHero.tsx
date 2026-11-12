import type { ReactNode } from "react";
import type { HeroKind } from "@/lib/premium/navigation";

/** Staff workspaces prioritize the next task over decorative page artwork. */
export function ClinicalHero({
  title,
  lede,
  action,
}: {
  title: string;
  lede?: string;
  action?: ReactNode;
  kind?: HeroKind;
  eyebrow?: string;
}) {
  return (
    <header className="ahp-workspace-header">
      <div className="ahp-hero-copy">
        <h1>{title}</h1>
        {lede && <p>{lede}</p>}
      </div>
      {action && <div className="ahp-workspace-actions">{action}</div>}
    </header>
  );
}
