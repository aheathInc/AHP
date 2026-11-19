import Link from "next/link";
import { serverGet } from "@/lib/serverToken";
import type { ClinicianDirectoryEntry, Page } from "@/lib/api";
import { Badge, Button, PageHeader, PageShell } from "@/components/ui";
import { VerificationActions } from "@/components/VerificationActions";
import { requireRole } from "@/lib/roles";
import {
  AdminSourceError,
  WorkspaceRefresh,
} from "@/components/admin/WorkspaceRefresh";
import { adminLabel } from "@/components/admin/operationsTypes";
import { adminDateTime as dateTime } from "@/components/admin/operationsTypes";
import styles from "@/components/admin/operations.module.css";

type Search = { status?: string; q?: string; cursor?: string };
export default async function VerificationPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireRole(["platform_admin"]);
  const status = ["pending", "verified", "rejected", "all"].includes(
    searchParams.status ?? "",
  )
    ? searchParams.status!
    : "pending";
  const q =
    typeof searchParams.q === "string"
      ? searchParams.q.trim().slice(0, 100)
      : "";
  const query = new URLSearchParams({ limit: "25" });
  if (status !== "all") query.set("verification_status", status);
  if (q) query.set("q", q);
  if (typeof searchParams.cursor === "string")
    query.set("cursor", searchParams.cursor);
  const result = await serverGet<Page<ClinicianDirectoryEntry>>(
    `/clinicians?${query}`,
  );
  function link(cursor?: string) {
    const p = new URLSearchParams({ status });
    if (q) p.set("q", q);
    if (cursor) p.set("cursor", cursor);
    return `/admin/verification?${p}`;
  }
  return (
    <PageShell className={styles.workspace}>
      <PageHeader
        title="Clinician verification"
        lede="Review professional credentials and record an accountable approval or rejection."
        action={<WorkspaceRefresh />}
      />
      <section className={styles.panel}>
        <form
          className={styles.filters}
          action="/admin/verification"
          method="get"
        >
          <div>
            <label htmlFor="verification-search">Search clinicians</label>
            <input
              id="verification-search"
              name="q"
              type="search"
              defaultValue={q}
              maxLength={100}
              placeholder="Name or licence number"
            />
          </div>
          <div>
            <label htmlFor="verification-status">Verification status</label>
            <select
              id="verification-status"
              name="status"
              defaultValue={status}
            >
              <option value="pending">Pending review</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
              <option value="all">All applications</option>
            </select>
          </div>
          <Button type="submit">Apply filters</Button>
        </form>
        {!result ? (
          <div className="px-6">
            <AdminSourceError title="Clinician applications could not be loaded" />
          </div>
        ) : (
          <>
            <div className={styles.listHeading}>
              <span>
                {result.data.length}{" "}
                {result.data.length === 1 ? "application" : "applications"} on
                this page
              </span>
              <span>Review each application individually</span>
            </div>
            {!result.data.length && (
              <div className={styles.empty}>
                <h2>
                  {q
                    ? "No matching applications"
                    : status === "pending"
                      ? "No applications awaiting review"
                      : "No applications in this view"}
                </h2>
                <p>
                  {q
                    ? "Try another name or licence number, or clear the search."
                    : "New applications will appear here when clinicians submit their credentials."}
                </p>
                <Link href="/admin/verification?status=all">
                  View all applications →
                </Link>
              </div>
            )}
            {result.data.map((c) => (
              <article
                key={c.id}
                className={styles.record}
                id={`clinician-${c.id}`}
              >
                <div className={styles.recordHead}>
                  <div>
                    <h2>{c.full_name || "Name not provided"}</h2>
                    <p>
                      {adminLabel(c.specialty)} · Licence{" "}
                      {c.license_number || "not provided"}
                    </p>
                  </div>
                  <Badge
                    tone={
                      c.verification_status === "verified"
                        ? "good"
                        : c.verification_status === "rejected"
                          ? "problem"
                          : "attention"
                    }
                  >
                    {adminLabel(c.verification_status ?? "pending")}
                  </Badge>
                </div>
                <details className={styles.details}>
                  <summary>
                    {c.verification_status === "pending"
                      ? "Review credentials and decide"
                      : "View application details"}
                  </summary>
                  <dl className={styles.facts}>
                    <div>
                      <dt>Professional licence</dt>
                      <dd>{c.license_number || "Not provided"}</dd>
                    </div>
                    <div>
                      <dt>Email</dt>
                      <dd>{c.email || "Not provided"}</dd>
                    </div>
                    <div>
                      <dt>Account status</dt>
                      <dd>{adminLabel(c.account_status || "not recorded")}</dd>
                    </div>
                    <div>
                      <dt>Last updated</dt>
                      <dd>{dateTime(c.updated_at)}</dd>
                    </div>
                    <div>
                      <dt>Record version</dt>
                      <dd>{c.version ?? "Not recorded"}</dd>
                    </div>
                  </dl>
                  {c.rejection_reason && (
                    <div className={styles.history}>
                      <h3>Recorded rejection reason</h3>
                      <p>{c.rejection_reason}</p>
                    </div>
                  )}
                  {c.verification_status === "pending" && (
                    <VerificationActions
                      key={`${c.id}-${c.version}`}
                      clinicianId={c.id}
                      clinicianName={c.full_name || "this clinician"}
                      expectedVersion={c.version}
                    />
                  )}
                </details>
              </article>
            ))}
            <nav
              className={styles.pagination}
              aria-label="Clinician application pages"
            >
              <Link href={link()}>First page</Link>
              <span>
                {result.meta?.has_more
                  ? "More applications available"
                  : "End of results"}
              </span>
              {result.meta?.has_more && result.meta.next_cursor && (
                <Link href={link(result.meta.next_cursor)}>Next page →</Link>
              )}
            </nav>
          </>
        )}
      </section>
    </PageShell>
  );
}
