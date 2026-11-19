"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { Icon } from "@/components/premium/Icon";
import styles from "./operations.module.css";

export function WorkspaceRefresh({
  automatic = false,
}: {
  automatic?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(automatic);
  useEffect(() => {
    if (!enabled || pending) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) start(() => router.refresh());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, pending, router]);
  return (
    <div className={styles.refresh}>
      {automatic && (
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Refresh every minute
        </label>
      )}
      <Button
        variant="quiet"
        onClick={() => start(() => router.refresh())}
        disabled={pending}
        aria-label="Refresh workspace"
      >
        <Icon name="history" size={16} />
        {pending ? "Refreshing…" : "Refresh"}
      </Button>
      <span className="sr-only" role="status">
        {pending ? "Refreshing workspace" : ""}
      </span>
    </div>
  );
}

export function AdminSourceError({
  title = "Records could not be loaded",
  children,
}: {
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={styles.sourceError} role="alert">
      <Icon name="alert" size={22} />
      <div>
        <h2>{title}</h2>
        <p>
          {children ??
            "The service did not return a response. Refresh to try again. No empty or zero count has been assumed."}
        </p>
        <WorkspaceRefresh />
      </div>
    </section>
  );
}
