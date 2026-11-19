"use client";
import { Button, PageShell } from "@/components/ui";
import styles from "@/components/admin/operations.module.css";
export default function AdminError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <PageShell className={styles.workspace}>
      <section className={styles.sourceError} role="alert">
        <div>
          <h1>This workspace could not be loaded</h1>
          <p>
            Try loading it again. Any unsaved form changes may need to be
            re-entered.
          </p>
          <Button onClick={reset}>Try again</Button>
        </div>
      </section>
    </PageShell>
  );
}
