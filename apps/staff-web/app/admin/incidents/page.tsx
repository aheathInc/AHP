import Link from "next/link";
import { serverGet } from "@/lib/serverToken";
import type { IncidentReport, Page } from "@/lib/api";
import { Badge, Button, PageHeader, PageShell } from "@/components/ui";
import { adminDateTime as dateTime } from "@/components/admin/operationsTypes";
import { requireRole } from "@/lib/roles";
import {
  AdminSourceError,
  WorkspaceRefresh,
} from "@/components/admin/WorkspaceRefresh";
import { IncidentActions } from "@/components/admin/IncidentActions";
import { adminLabel } from "@/components/admin/operationsTypes";
import styles from "@/components/admin/operations.module.css";

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: { status?: string; severity?: string; cursor?: string };
}) {
  await requireRole(["platform_admin"]);
  const statuses = [
    "open",
    "reported",
    "under_investigation",
    "action_taken",
    "closed",
    "all",
  ];
  const severities = ["all", "low", "moderate", "serious", "catastrophic"];
  const status = statuses.includes(searchParams.status ?? "")
    ? searchParams.status!
    : "open";
  const severity = severities.includes(searchParams.severity ?? "")
    ? searchParams.severity!
    : "all";
  const query = new URLSearchParams({ limit: "25" });
  if (status !== "all") query.set("status", status);
  if (severity !== "all") query.set("severity", severity);
  if (typeof searchParams.cursor === "string")
    query.set("cursor", searchParams.cursor);
  const result = await serverGet<Page<IncidentReport>>(
    `/incident-reports?${query}`,
  );
  function link(cursor?: string) {
    const p = new URLSearchParams({ status, severity });
    if (cursor) p.set("cursor", cursor);
    return `/admin/incidents?${p}`;
  }
  return (
    <PageShell className={styles.workspace}>
      <PageHeader
        title="Incident management"
        lede="Investigate reports, record corrective action and close cases with a clear governance history."
        action={<WorkspaceRefresh />}
      />
      <section className={styles.panel}>
        <form action="/admin/incidents" method="get" className={styles.filters}>
          <div>
            <label htmlFor="incident-status-filter">Case status</label>
            <select
              id="incident-status-filter"
              name="status"
              defaultValue={status}
            >
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {value === "open"
                    ? "All open incidents"
                    : value === "all"
                      ? "All statuses"
                      : adminLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="incident-severity-filter">Severity</label>
            <select
              id="incident-severity-filter"
              name="severity"
              defaultValue={severity}
            >
              {severities.map((value) => (
                <option key={value} value={value}>
                  {value === "all" ? "All severities" : adminLabel(value)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">Apply filters</Button>
        </form>
        {!result ? (
          <div className="px-6">
            <AdminSourceError title="Incident reports could not be loaded" />
          </div>
        ) : (
          <>
            <div className={styles.listHeading}>
              <span>
                {result.data.length}{" "}
                {result.data.length === 1 ? "incident" : "incidents"} on this
                page
              </span>
              <span>Anonymous reporters remain unidentified</span>
            </div>
            {!result.data.length && (
              <div className={styles.empty}>
                <h2>No incidents in this view</h2>
                <p>
                  There are no reports matching these filters. New reports will
                  appear when submitted.
                </p>
                <Link href="/admin/incidents?status=all">
                  View all statuses →
                </Link>
              </div>
            )}
            {result.data.map((r) => (
              <article
                key={`${r.id}-${r.version}`}
                className={styles.record}
                id={`incident-${r.id}`}
              >
                <div className={styles.recordHead}>
                  <div>
                    <h2>{adminLabel(r.category)}</h2>
                    <p>
                      Case {r.id.slice(0, 8).toUpperCase()} · Reported{" "}
                      {dateTime(r.reported_at)}
                    </p>
                  </div>
                  <div className={styles.badges}>
                    <Badge
                      tone={
                        ["serious", "catastrophic"].includes(r.severity)
                          ? "problem"
                          : r.severity === "moderate"
                            ? "attention"
                            : "neutral"
                      }
                    >
                      {adminLabel(r.severity)}
                    </Badge>
                    <Badge tone={r.status === "closed" ? "good" : "info"}>
                      {adminLabel(r.status)}
                    </Badge>
                    {r.escalated_to_governance && (
                      <Badge tone="attention">Escalated</Badge>
                    )}
                  </div>
                </div>
                <details className={styles.details}>
                  <summary>Review case and next step</summary>
                  <dl className={styles.facts}>
                    <div>
                      <dt>Reporter</dt>
                      <dd>{r.anonymous ? "Anonymous" : "Identified report"}</dd>
                    </div>
                    <div>
                      <dt>Last updated</dt>
                      <dd>{dateTime(r.updated_at)}</dd>
                    </div>
                    <div>
                      <dt>Closed</dt>
                      <dd>{dateTime(r.closed_at)}</dd>
                    </div>
                  </dl>
                  <h3>Reported concern</h3>
                  <p className={styles.description}>{r.description}</p>
                  {r.investigation_notes && (
                    <div className={styles.history}>
                      <h3>Investigation notes</h3>
                      <p>{r.investigation_notes}</p>
                    </div>
                  )}
                  {r.action_taken && (
                    <div className={styles.history}>
                      <h3>Recorded action</h3>
                      <p>{r.action_taken}</p>
                    </div>
                  )}
                  <IncidentActions key={`${r.id}-${r.version}`} incident={r} />
                </details>
              </article>
            ))}
            <nav
              className={styles.pagination}
              aria-label="Incident report pages"
            >
              <Link href={link()}>First page</Link>
              <span>
                {result.meta?.has_more
                  ? "More incident reports available"
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
