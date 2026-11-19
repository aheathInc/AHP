import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serverGet } from "@/lib/serverToken";
import { PageHeader, PageShell, Badge } from "@/components/ui";
import { ProfileForm } from "@/components/ProfileForm";
import { AdminSourceError } from "@/components/admin/WorkspaceRefresh";
import { requireRole } from "@/lib/roles";
import styles from "@/components/admin/operations.module.css";

interface Me {
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  preferred_language: string | null;
  role: string;
  status: string;
}
export default async function SettingsPage() {
  await requireRole(["platform_admin", "facility_admin"]);
  const [me, session] = await Promise.all([
    serverGet<Me>("/users/me"),
    getServerSession(authOptions),
  ]);
  return (
    <PageShell className={styles.workspace}>
      <PageHeader
        title="Account settings"
        lede="Manage your profile and language preferences for the administration workspace."
      />
      <div className={styles.settings}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <h2>Profile details</h2>
              <p>Email and phone changes require identity verification.</p>
            </div>
          </div>
          <div className={styles.settingsContent}>
            {me ? (
              <ProfileForm
                initialName={me.full_name ?? ""}
                initialLanguage={me.preferred_language ?? "sw"}
                email={me.email}
                phone={me.phone_number}
                locale="en"
              />
            ) : (
              <AdminSourceError title="Your profile could not be loaded" />
            )}
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeading}>
            <div>
              <h2>Access & accountability</h2>
              <p>
                Your assigned role determines the records and actions available
                to you.
              </p>
            </div>
          </div>
          <div className={styles.settingsContent}>
            <dl className={styles.facts}>
              <div>
                <dt>Workspace role</dt>
                <dd>
                  {session?.user?.role === "platform_admin"
                    ? "Platform administrator"
                    : "Facility administrator"}
                </dd>
              </div>
              <div>
                <dt>Account status</dt>
                <dd>
                  {me ? (
                    <Badge tone={me.status === "active" ? "good" : "neutral"}>
                      {me.status}
                    </Badge>
                  ) : (
                    "Unavailable"
                  )}
                </dd>
              </div>
            </dl>
            <p>
              Administrator decisions are attributed to your signed-in account.
              Use an individual staff account for each operator.
            </p>
            {session?.user?.role === "platform_admin" && (
              <p className="mt-4">
                <Link href="/admin/audit-ledger">Review audit ledger →</Link>
              </p>
            )}
            <p>To end this session, use Sign out in the navigation.</p>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
