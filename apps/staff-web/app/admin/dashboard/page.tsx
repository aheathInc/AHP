import Link from "next/link";
import { PageHeader, PageShell, Badge } from "@/components/ui";
import { Icon } from "@/components/premium/Icon";
import { serverGet } from "@/lib/serverToken";
import { requireRole } from "@/lib/roles";
import {
  AdminSourceError,
  WorkspaceRefresh,
} from "@/components/admin/WorkspaceRefresh";
import {
  adminNumber,
  waitingSince,
  type OperationsOverview,
} from "@/components/admin/operationsTypes";
import styles from "@/components/admin/operations.module.css";

export default async function AdminDashboard() {
  await requireRole(["platform_admin"]);
  const report = await serverGet<OperationsOverview>(
    "/surveillance/operations-overview",
  );
  const counts = report?.counts;
  const queues = report
    ? [
        {
          title: "Emergency acknowledgement",
          detail: "Requests awaiting a dispatcher acknowledgement",
          count: report.counts.unacknowledged_emergencies,
          oldest: report.oldest.unacknowledged_emergency_at,
          href: "/admin/emergency",
          action: "Open dispatch",
          icon: "activity",
          critical: true,
        },
        {
          title: "Escalated incidents",
          detail: "Governance reports requiring investigation or follow-up",
          count: report.counts.escalated_incidents,
          oldest: report.oldest.escalated_incident_at,
          href: "/admin/incidents?status=open",
          action: "Review incidents",
          icon: "alert",
          critical: true,
        },
        {
          title: "Clinician applications",
          detail: "Credentials awaiting an administrator decision",
          count: report.counts.pending_verifications,
          oldest: report.oldest.pending_verification_at,
          href: "/admin/verification",
          action: "Review credentials",
          icon: "shield",
          critical: false,
        },
      ]
    : [];
  return (
    <PageShell className={styles.workspace}>
      <PageHeader
        title="Platform overview"
        lede="Prioritize care operations, review credentials and follow through on governance work."
        action={<WorkspaceRefresh automatic />}
      />
      {report ? (
        <div className={styles.snapshot}>
          <p>Platform-wide operational records</p>
          <p>
            <Badge
              tone={
                report.environment === "production" ? "neutral" : "attention"
              }
            >
              {report.environment === "production"
                ? "Production"
                : "Development environment"}
            </Badge>{" "}
            · Updated{" "}
            <time dateTime={report.generated_at}>
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: "Africa/Dar_es_Salaam",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(report.generated_at))}
            </time>{" "}
            EAT
          </p>
        </div>
      ) : (
        <AdminSourceError title="Operational overview is unavailable">
          The operational records service could not be reached. Refresh this
          view or open the relevant workspace below.
        </AdminSourceError>
      )}
      <section
        className={styles.prioritySection}
        aria-labelledby="priority-queues"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="priority-queues">Priority queues</h2>
            <p>
              Open the relevant workspace to review the record and take action.
            </p>
          </div>
          <Link href="/admin/incidents">All incident reports →</Link>
        </div>
        {report && (
          <>
            <div className={styles.queueGrid}>
              {queues.map((q) => (
                <article className={styles.queueCard} key={q.href}>
                  <div className={styles.queueTitle}>
                    <span className={styles.queueIcon}>
                      <Icon name={q.icon} size={23} />
                    </span>
                    <h3>{q.title}</h3>
                  </div>
                  <p>{q.detail}</p>
                  <div className={styles.queueCount}>
                    <strong>{adminNumber(q.count)}</strong>
                    <span>awaiting action</span>
                    {q.count > 0 && (
                      <Badge tone={q.critical ? "problem" : "attention"}>
                        Needs review
                      </Badge>
                    )}
                  </div>
                  <div className={styles.queueWait}>
                    <span>Oldest waiting</span>
                    <strong>
                      {q.count
                        ? waitingSince(q.oldest, report.generated_at)
                        : "No waiting records"}
                    </strong>
                  </div>
                  <Link href={q.href}>
                    {q.action}
                    <Icon name="chevron" size={18} />
                  </Link>
                </article>
              ))}
            </div>
            <p className={styles.queueScope}>
              Counts cover all matching platform records. Waiting time is
              measured from the oldest open record.
            </p>
          </>
        )}
        {!report && (
          <ul className={styles.links}>
            {[
              { href: "/admin/emergency", label: "Emergency dispatch" },
              { href: "/admin/incidents", label: "Incident reports" },
              { href: "/admin/verification", label: "Clinician verification" },
            ].map((x) => (
              <li key={x.href}>
                <Link href={x.href}>
                  <span>{x.label}</span>
                  <Icon name="chevron" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className={styles.lower}>
        <section className={styles.panel} aria-labelledby="service-coverage">
          <div className={styles.panelHeading}>
            <div>
              <h2 id="service-coverage">Service coverage</h2>
              <p>Recorded capacity and activity across the platform.</p>
            </div>
          </div>
          <dl className={styles.coverage}>
            {[
              {
                label: "Registered facilities",
                value: counts?.facilities,
                href: "/admin/facilities",
              },
              {
                label: "Active devices",
                value: counts?.active_devices,
                href: "/admin/devices",
              },
              {
                label: "Open emergency requests",
                value: counts?.open_emergencies,
                href: "/admin/emergency",
              },
              {
                label: "Open incident reports",
                value: counts?.open_incidents,
                href: "/admin/incidents?status=open",
              },
            ].map((x) => (
              <div key={x.label}>
                <dt>{x.label}</dt>
                <dd>
                  <Link
                    href={x.href}
                    aria-label={`${x.label}: ${x.value === undefined ? "unavailable" : adminNumber(x.value)}`}
                  >
                    {x.value === undefined
                      ? "Unavailable"
                      : adminNumber(x.value)}
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
          <div className={styles.listHeading}>
            <span>Failed payment attempts · last 24 hours</span>
            <Link href="/admin/payments">
              {counts ? adminNumber(counts.failed_payments_24h) : "Unavailable"}{" "}
              · Review →
            </Link>
          </div>
          <p className="px-6 pb-4 text-sm">
            Payment attempts include recorded test and live environments. This
            is not a settlement balance.
          </p>
        </section>
        <section className={styles.panel} aria-labelledby="governance-tools">
          <div className={styles.panelHeading}>
            <div>
              <h2 id="governance-tools">Governance & administration</h2>
              <p>
                Review accountability, connected systems and platform
                performance.
              </p>
            </div>
          </div>
          <ul className={styles.links}>
            {[
              {
                href: "/admin/audit-ledger",
                title: "Audit ledger",
                detail: "Review recorded actions and verify ledger integrity",
                icon: "history",
              },
              {
                href: "/admin/professional-network",
                title: "Professional network moderation",
                detail: "Review reports and community governance decisions",
                icon: "shield",
              },
              {
                href: "/admin/interoperability",
                title: "Connected health systems",
                detail: "Review integration registry and identity exceptions",
                icon: "network",
              },
              {
                href: "/admin/insights",
                title: "Health & regional insights",
                detail: "Explore published aggregates and disease trends",
                icon: "chart",
              },
              {
                href: "/admin/settings",
                title: "Account settings",
                detail: "Manage your profile and account preferences",
                icon: "settings",
              },
            ].map((x) => (
              <li key={x.href}>
                <Link href={x.href}>
                  <Icon name={x.icon} size={20} />
                  <span>
                    <strong>{x.title}</strong>
                    <small>{x.detail}</small>
                  </span>
                  <Icon name="chevron" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
