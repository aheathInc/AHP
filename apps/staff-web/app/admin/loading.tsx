import { PageShell } from "@/components/ui";
import styles from "@/components/admin/operations.module.css";
export default function AdminLoading() {
  return (
    <PageShell className={styles.workspace}>
      <div role="status" aria-label="Loading administration workspace">
        <p>Loading administration workspace…</p>
        <div className={styles.skeleton} aria-hidden="true" />
        <div className={styles.skeleton} aria-hidden="true" />
      </div>
    </PageShell>
  );
}
