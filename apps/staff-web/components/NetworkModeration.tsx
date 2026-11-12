"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { api, errorMessage, type Page } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Button, Empty, Notice, PageHeader, PageShell } from "./ui";
interface Report {
  id: string;
  discussionId: string;
  replyId: string | null;
  category: string;
  status: string;
  version: number;
  created_at: string;
  reviewed_at: string | null;
  group_name: string;
  title: string;
  body: string;
  hidden: boolean;
  reporter_clinician_id: string;
}
export function NetworkModeration() {
  const { data, status } = useSession();
  if (status === "loading")
    return <p role="status">Verifying moderation access…</p>;
  if (status !== "authenticated" || data?.user?.role !== "platform_admin")
    return <Notice>Platform moderator access is required.</Notice>;
  return <Moderation key={data.user.id} />;
}
function Moderation() {
  const [rows, setRows] = useState<Report[]>([]),
    [filter, setFilter] = useState("open"),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const revision = useRef(0),
    lock = useRef(false);
  const load = useCallback(
    async (next?: string) => {
      const run = ++revision.current;
      setLoading(true);
      setError(null);
      try {
        const response = await api.get<Page<Report>>(
          "/network/moderation/reports",
          { params: { status: filter, limit: 25, cursor: next } },
        );
        if (run !== revision.current) return;
        setRows((current) =>
          next ? [...current, ...response.data.data] : response.data.data,
        );
        setCursor(response.data.meta?.next_cursor ?? null);
      } catch (cause) {
        if (run === revision.current) {
          setRows([]);
          setCursor(null);
          setError(
            errorMessage(cause, "Moderation reports could not be verified."),
          );
        }
      } finally {
        if (run === revision.current) setLoading(false);
      }
    },
    [filter],
  );
  useEffect(() => {
    setRows([]);
    void load();
    return () => {
      revision.current++;
    };
  }, [load]);
  async function decide(report: Report, action: "hide" | "dismiss") {
    if (
      lock.current ||
      !window.confirm(
        action === "hide"
          ? "Hide this reported contribution from group views? The original will be retained for accountable moderation."
          : "Dismiss this report without hiding its content?",
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/network/moderation/reports/${report.id}/review`, {
        base_version: report.version,
        action,
      });
      setNotice(
        action === "hide"
          ? "Contribution hidden and decision recorded."
          : "Report dismissed and decision recorded.",
      );
      await load();
    } catch (cause) {
      setRows([]);
      setError(
        errorMessage(
          cause,
          "The report changed or access was denied. Refresh before deciding again.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="Professional network moderation"
        lede="Review reported contributions against institutional confidentiality, evidence and professional-conduct policy. Access to this queue is audited."
        action={
          <Button
            variant="quiet"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            Refresh reports
          </Button>
        }
      />
      <p className="text-sm text-ink-soft">
        Reporting does not automatically hide a contribution. A moderation
        decision controls group distribution; it is not verification of clinical
        advice.
      </p>
      <div className="flex flex-wrap gap-2">
        {[
          ["open", "Awaiting review"],
          ["reviewed", "Reviewed reports"],
          ["all", "All reports"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            disabled={busy}
            aria-pressed={filter === value}
            className={`min-h-11 rounded-lg border px-3 py-2 ${filter === value ? "bg-petrol text-white" : "border-line bg-white"}`}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      {notice && (
        <p role="status" className="rounded-lg border border-line p-4">
          {notice}
        </p>
      )}
      {loading && <p role="status">Checking reports…</p>}
      {!loading && !error && !rows.length && (
        <Empty>No reports match this moderation queue.</Empty>
      )}
      <ul className="space-y-4">
        {rows.map((report) => (
          <li
            key={report.id}
            className="space-y-4 rounded-xl border border-line bg-white p-5"
          >
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{report.title}</h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {report.group_name} ·{" "}
                  {report.replyId ? "Reply" : "Discussion"} ·{" "}
                  {dateTime(report.created_at)}
                </p>
              </div>
              <Badge tone={report.status === "open" ? "attention" : "neutral"}>
                {report.status}
              </Badge>
            </div>
            <p className="font-medium">
              Concern: {report.category.replace(/_/g, " ")}
            </p>
            <details>
              <summary className="min-h-11 cursor-pointer font-medium">
                Review reported content
              </summary>
              <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-paper-sunk p-4">
                {report.body}
              </p>
            </details>
            <p className="text-sm text-ink-soft">
              {report.hidden
                ? "Already hidden from group views."
                : "Currently visible to authorized group members."}{" "}
              Reference: {report.id}
            </p>
            {report.status === "open" && (
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="danger"
                  disabled={busy || loading}
                  onClick={() => void decide(report, "hide")}
                >
                  Hide contribution
                </Button>
                <Button
                  variant="quiet"
                  disabled={busy || loading}
                  onClick={() => void decide(report, "dismiss")}
                >
                  Dismiss report
                </Button>
              </div>
            )}
            {report.reviewed_at && (
              <p className="text-sm text-ink-soft">
                Reviewed {dateTime(report.reviewed_at)}
              </p>
            )}
          </li>
        ))}
      </ul>
      {cursor && (
        <Button
          variant="quiet"
          disabled={busy || loading}
          onClick={() => void load(cursor)}
        >
          Load more reports
        </Button>
      )}
    </PageShell>
  );
}
