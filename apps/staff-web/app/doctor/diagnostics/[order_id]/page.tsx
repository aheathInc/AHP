import { DiagnosticReport } from "@/components/DiagnosticReport";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serverGet } from "@/lib/serverToken";
import type { InvestigationOrder } from "@/lib/api";
import { Notice } from "@/components/ui";
import { AcknowledgeResult } from "@/components/AcknowledgeResult";

export default async function OrderPage({
  params,
}: {
  params: { order_id: string };
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const o = await serverGet<InvestigationOrder>(
    `/investigation-orders/${params.order_id}`,
  );
  if (!o) {
    return (
      <div className="staff-page ahp-page">
        <Notice>Kipimo hiki hakikupatikana.</Notice>
      </div>
    );
  }

  return (
    <div className="staff-page ahp-page space-y-6">
      <Link
        href="/doctor/diagnostics"
        className="text-sm text-petrol underline underline-offset-4"
      >
        Back to diagnostics worklist
      </Link>
      <DiagnosticReport ownerId={session.user?.id} order={o} />
      {o.status === "resulted" && (
        <AcknowledgeResult orderId={o.id} version={o.version} />
      )}
      {o.status === "acknowledged" && (
        <p className="text-sm text-ink-soft">
          The ordering clinician has acknowledged this report.
        </p>
      )}
    </div>
  );
}
