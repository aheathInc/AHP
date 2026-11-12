"use client";
import { useSession } from "next-auth/react";
import type { InvestigationOrder } from "@/lib/api";
const reportDate = (value: string | null | undefined) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }).format(new Date(value))
    : "Not recorded";
import { Badge, Button, Notice } from "./ui";
export const diagnosticStatus = (o: InvestigationOrder) =>
  o.report_state === "preliminary"
    ? "Preliminary — awaiting release"
    : ({
        ordered: "Awaiting specimen",
        scheduled: "Scheduled",
        collected: "Specimen received",
        resulted: "Final — awaiting clinician review",
        acknowledged: "Reviewed by clinician",
        cancelled: "Cancelled",
      }[o.status] ?? o.status);
export const resultLabel = (flag: string) =>
  ({
    normal: "Within supplied interval",
    low: "Low",
    high: "High",
    critical_low: "Critical low",
    critical_high: "Critical high",
    not_assessed: "Not automatically assessed",
  })[flag] ?? flag;
export function DiagnosticReport({
  order: o,
  ownerId,
}: {
  order: InvestigationOrder;
  ownerId?: string;
}) {
  const { data: session, status } = useSession();
  if (ownerId && (status !== "authenticated" || session?.user?.id !== ownerId))
    return <Notice>Refresh this report using the authorized account.</Notice>;
  const final = ["resulted", "acknowledged"].includes(o.status);
  return (
    <section
      className="diagnostic-report space-y-6 rounded-xl border border-line bg-white p-5 sm:p-6"
      aria-label="Diagnostic report"
    >
      <style>{`@media print { body * { visibility:hidden!important; } .diagnostic-report,.diagnostic-report * { visibility:visible!important; } .diagnostic-report { position:absolute;left:0;top:0;width:100%;color:#111;background:white;padding:20px; } .diagnostic-report .print-hide {display:none!important;} .diagnostic-report table{width:100%;border-collapse:collapse;} .diagnostic-report th,.diagnostic-report td {padding:8px;border-bottom:1px solid #ccc;text-align:left;} }`}</style>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="text-sm text-ink-soft">
            {o.facility_name ?? "Clinician-managed investigation"}
          </p>
          <h2 className="mt-1 text-xl font-semibold">
            Diagnostic report · {o.investigation_code}
          </h2>
          <p className="mt-2 text-sm">
            {final
              ? "Final report"
              : o.report_state === "preliminary"
                ? "PRELIMINARY — not released"
                : "Results pending"}
          </p>
        </div>
        <div className="print-hide">
          <Button
            variant="quiet"
            disabled={!final}
            onClick={() => window.print()}
          >
            Print final report
          </Button>
        </div>
      </header>
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        {[
          ["Patient", o.patient_name ?? "Name unavailable"],
          ["Patient reference", o.patient_profile_id],
          ["Order reference", o.id],
          ["Ordering clinician", o.ordering_clinician ?? "Not recorded"],
          ["Investigation", o.investigation_type.replace(/_/g, " ")],
          ["Priority", o.urgency],
          ["Specimen reference", o.specimen_reference ?? "Not recorded"],
          ["Specimen type", o.specimen_type ?? "Not recorded"],
          ["Collected", reportDate(o.collected_at)],
          ["Received in laboratory", reportDate(o.received_at)],
          ["Ordered", reportDate(o.ordered_at)],
          ["Report released", reportDate(o.resulted_at)],
          [
            "Authorized for release by",
            o.released_by_name ?? o.released_by_id ?? "Not recorded",
          ],
          ["Clinician acknowledgement", reportDate(o.acknowledged_at)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-ink-soft">{label}</dt>
            <dd className="mt-1 break-words font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {o.is_critical && (
        <div
          role="alert"
          className="rounded-lg border border-clay p-4 text-clay"
        >
          <strong>
            Critical result {final ? "reported" : "in preliminary findings"}.
          </strong>
          <p className="mt-1">
            {o.acknowledged_at
              ? "Clinician acknowledgement is recorded."
              : "Contact the responsible clinician through the facility’s urgent communication process. Displaying this report is not acknowledgement."}
          </p>
        </div>
      )}
      {o.values.length ? (
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Result values"
        >
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="p-3">Test / analyte</th>
                <th className="p-3">Result</th>
                <th className="p-3">Unit</th>
                <th className="p-3">Reference interval</th>
                <th className="p-3">Flag</th>
              </tr>
            </thead>
            <tbody>
              {o.values.map((v, i) => (
                <tr key={i} className="border-b border-line">
                  <th scope="row" className="p-3 font-medium">
                    {v.analyte}
                  </th>
                  <td className="p-3 tabular-nums font-semibold">{v.value}</td>
                  <td className="p-3">{v.unit ?? "—"}</td>
                  <td className="p-3 tabular-nums">
                    {v.reference_low == null && v.reference_high == null
                      ? "Not supplied"
                      : `${v.reference_low ?? "—"} – ${v.reference_high ?? "—"}`}
                  </td>
                  <td className="p-3">
                    <Badge
                      tone={
                        v.flag.startsWith("critical")
                          ? "problem"
                          : v.flag === "high" || v.flag === "low"
                            ? "attention"
                            : "neutral"
                      }
                    >
                      {resultLabel(v.flag)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg bg-paper-sunk p-4">
          Results have not been released for this order.
        </p>
      )}
      {o.narrative && (
        <div>
          <h3 className="font-semibold">Laboratory comments</h3>
          <p className="mt-2 whitespace-pre-wrap">{o.narrative}</p>
        </div>
      )}
      <p className="border-t border-line pt-4 text-sm text-ink-soft">
        Ranges and units are supplied for this report. Qualitative results and
        values without applicable bounds are not automatically assessed. This
        report records findings; clinical interpretation belongs to the treating
        clinician.
      </p>
    </section>
  );
}
