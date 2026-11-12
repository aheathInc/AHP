"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import {
  api,
  errorMessage,
  type InvestigationOrder,
  type Page,
} from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Button, Empty, Notice, inputClass } from "../ui";
import { diagnosticStatus } from "../DiagnosticReport";
export function DiagnosticsTable({
  orders,
  initialCursor,
  ownerId,
}: {
  orders: InvestigationOrder[];
  initialCursor?: string | null;
  ownerId?: string;
}) {
  const { data: session, status } = useSession();
  if (
    status !== "authenticated" ||
    !session?.user ||
    session.user.role !== "clinician" ||
    (ownerId && session.user.id !== ownerId)
  )
    return (
      <Notice>
        Sign in with the ordering clinician account to access diagnostics.
      </Notice>
    );
  return (
    <Worklist
      key={session.user.id}
      initial={orders}
      initialCursor={initialCursor}
    />
  );
}
function Worklist({
  initial,
  initialCursor,
}: {
  initial: InvestigationOrder[];
  initialCursor?: string | null;
}) {
  const [orders, setOrders] = useState(initial),
    [cursor, setCursor] = useState(initialCursor ?? null),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [appliedQuery, setAppliedQuery] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [checked, setChecked] = useState<string | null>(null);
  const revision = useRef(0);
  async function load(worklist = filter, q = appliedQuery, next?: string) {
    const run = ++revision.current;
    setBusy(true);
    setError(null);
    if (!next) {
      setOrders([]);
      setCursor(null);
    }
    try {
      const r = await api.get<Page<InvestigationOrder>>(
        "/investigation-orders",
        { params: { limit: 50, worklist, q: q || undefined, cursor: next } },
      );
      if (run !== revision.current) return;
      setOrders((current) =>
        next
          ? Array.from(
              new Map(
                [...current, ...r.data.data].map((row) => [row.id, row]),
              ).values(),
            )
          : r.data.data,
      );
      setCursor(r.data.meta?.next_cursor ?? null);
      setChecked(new Date().toISOString());
    } catch (cause) {
      if (run === revision.current)
        setError(
          errorMessage(
            cause,
            "Diagnostic orders could not be loaded. Retry the search.",
          ),
        );
    } finally {
      if (run === revision.current) setBusy(false);
    }
  }
  function search(e: FormEvent) {
    e.preventDefault();
    setAppliedQuery(query.trim());
    void load(filter, query.trim());
  }
  return (
    <section className="space-y-5" aria-label="Diagnostic worklist">
      <div className="flex flex-wrap gap-2" aria-label="Worklist filters">
        {[
          ["all", "All orders"],
          ["awaiting_sample", "Awaiting specimen"],
          ["in_lab", "In laboratory"],
          ["review", "Awaiting clinician review"],
          ["critical", "Critical · unacknowledged"],
          ["acknowledged", "Reviewed"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            className={`rounded-lg border px-3 py-2 text-sm ${filter === value ? "border-petrol bg-petrol text-white" : "border-line bg-white"}`}
            onClick={() => {
              setFilter(value);
              void load(value);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <form onSubmit={search} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label
            htmlFor="diagnostic-search"
            className="mb-2 block text-sm font-medium"
          >
            Find an order
          </label>
          <input
            id="diagnostic-search"
            type="search"
            maxLength={100}
            className={inputClass}
            placeholder="Patient name, test, specimen reference or order ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button disabled={busy}>Search</Button>
        <Button
          type="button"
          variant="quiet"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh worklist
        </Button>
      </form>
      <p className="text-sm text-ink-soft" aria-live="polite">
        {busy
          ? "Loading orders…"
          : `${orders.length} loaded orders${checked ? ` · checked ${dateTime(checked)}` : ""}.`}{" "}
        Filters and search apply before pagination.
      </p>
      {error && <Notice>{error}</Notice>}
      {!busy && !error && !orders.length ? (
        <Empty>
          No orders match this worklist. Choose another filter or search term.
        </Empty>
      ) : (
        <>
          <ul className="divide-y divide-line sm:hidden">
            {orders.map((o) => (
              <li key={o.id} className="space-y-2 py-5">
                <h2 className="font-semibold">
                  {o.patient_name ?? "Patient name unavailable"}
                </h2>
                <p>
                  {o.investigation_code} · {o.urgency}
                </p>
                <p className="text-sm text-ink-soft">
                  {o.facility_name ?? "Clinician managed"}
                  {o.specimen_reference ? ` · ${o.specimen_reference}` : ""}
                </p>
                <Badge
                  tone={
                    o.is_critical && !o.acknowledged_at ? "problem" : "neutral"
                  }
                >
                  {diagnosticStatus(o)}
                </Badge>
                <p className="text-sm text-ink-soft">
                  Ordered {dateTime(o.ordered_at)}
                </p>
                <Link
                  className="ahp-view-link"
                  href={`/doctor/diagnostics/${o.id}`}
                >
                  Open report
                </Link>
              </li>
            ))}
          </ul>
          <div
            className="hidden overflow-x-auto rounded-xl border border-line bg-white sm:block"
            role="region"
            tabIndex={0}
            aria-label="Diagnostic worklist table"
          >
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-paper-sunk">
                  <th className="p-4">Patient / test</th>
                  <th className="p-4">Laboratory / specimen</th>
                  <th className="p-4">Priority</th>
                  <th className="p-4">Workflow</th>
                  <th className="p-4">Ordered</th>
                  <th className="p-4">Report</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-line">
                    <th scope="row" className="p-4 font-normal">
                      <p className="font-semibold">
                        {o.patient_name ?? "Name unavailable"}
                      </p>
                      <p className="mt-1">{o.investigation_code}</p>
                      <p className="mt-1 text-xs text-ink-soft">
                        {o.investigation_type.replace(/_/g, " ")}
                      </p>
                    </th>
                    <td className="p-4">
                      {o.facility_name ?? "Clinician managed"}
                      <p className="mt-1 text-xs text-ink-soft">
                        {o.specimen_reference ?? "Specimen not recorded"}
                      </p>
                    </td>
                    <td className="p-4">
                      <Badge
                        tone={
                          o.urgency === "emergency"
                            ? "problem"
                            : o.urgency === "urgent"
                              ? "attention"
                              : "neutral"
                        }
                      >
                        {o.urgency}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <Badge
                        tone={
                          o.is_critical && !o.acknowledged_at
                            ? "problem"
                            : o.status === "acknowledged"
                              ? "good"
                              : "neutral"
                        }
                      >
                        {o.is_critical ? "Critical · " : ""}
                        {diagnosticStatus(o)}
                      </Badge>
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      {dateTime(o.ordered_at)}
                    </td>
                    <td className="p-4">
                      <Link
                        href={`/doctor/diagnostics/${o.id}`}
                        className="ahp-view-link"
                      >
                        Open
                        <span className="sr-only">
                          {" "}
                          {o.investigation_code} for {o.patient_name}
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {cursor && (
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => void load(filter, appliedQuery, cursor)}
        >
          Load more orders
        </Button>
      )}
    </section>
  );
}
