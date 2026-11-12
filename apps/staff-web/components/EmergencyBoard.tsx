"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api, type EmergencyRequest, type Page } from "@/lib/api";
import { Badge, Card, Empty, Loading, Notice } from "./ui";
import { STATUS_LABEL } from "@/lib/emergency";
import { dateTime } from "@/lib/format";
export function EmergencyBoard() {
  const { data: session, status } = useSession();
  const [items, setItems] = useState<EmergencyRequest[]>([]),
    [loading, setLoading] = useState(true);
  const [closed, setClosed] = useState(false),
    [pages, setPages] = useState(1),
    [more, setMore] = useState(false);
  const [asOf, setAsOf] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setItems([]);
    setLoading(true);
    setAsOf(null);
    setError(null);
    async function load() {
      if (cancelled || status !== "authenticated") return;
      if (document.hidden) {
        timer = setTimeout(load, 5000);
        return;
      }
      try {
        const rows: EmergencyRequest[] = [];
        let cursor: string | undefined;
        let hasMore = false;
        let snapshot: string | undefined;
        for (let page = 0; page < pages; page++) {
          const response = await api.get<
            Page<EmergencyRequest> & { as_of: string }
          >("/emergency-requests", {
            params: {
              scope: closed ? "closed" : "active",
              limit: 50,
              ...(cursor ? { cursor } : {}),
            },
          });
          if (cancelled) return;
          rows.push(...response.data.data);
          snapshot = response.data.as_of;
          hasMore = response.data.meta?.has_more === true;
          cursor = response.data.meta?.next_cursor ?? undefined;
          if (!hasMore || !cursor) break;
        }
        setItems(Array.from(new Map(rows.map((row) => [row.id, row])).values()));
        setMore(hasMore);
        setAsOf(snapshot ?? new Date().toISOString());
        setError(null);
      } catch {
        if (!cancelled)
          setError(
            "Emergency updates failed. Displayed information may be out of date. Retry or use the operational phone/radio channel.",
          );
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(load, 5000);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [closed, pages, revision, session?.user?.id, status]);
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={!closed}
          className="min-h-11 rounded border border-line px-4"
          onClick={() => {
            setClosed(false);
            setPages(1);
          }}
        >
          Active
        </button>
        <button
          type="button"
          aria-pressed={closed}
          className="min-h-11 rounded border border-line px-4"
          onClick={() => {
            setClosed(true);
            setPages(1);
          }}
        >
          Closed
        </button>
        <button
          type="button"
          className="min-h-11 rounded border border-line px-4"
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh now
        </button>
      </div>
      <p className="text-sm text-ink-soft">
        {asOf
          ? `Last checked ${dateTime(asOf)} · ${items.length} loaded records`
          : "Waiting for a confirmed server response"}{" "}
        · Refreshes every 5 seconds while this tab is visible.
      </p>
      <p className="text-sm text-ink-soft">
        Highest response priority first, then reports awaiting assessment, then
        other assessed reports. Mass-casualty scale and oldest report break
        ties. Priority is set by dispatch staff, never inferred from account
        type.
      </p>
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty>
          {closed
            ? "No closed emergency requests."
            : "No active emergency requests in the loaded response."}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => (
            <li key={e.id}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={`/admin/emergency/${e.id}`}
                    className="font-semibold text-petrol underline underline-offset-4"
                  >
                    {e.scale === "mass_casualty"
                      ? "Mass casualty"
                      : "Individual"}{" "}
                    · {e.category.replace(/_/g, " ")}
                  </Link>
                  <Badge
                    tone={e.priority === "highest" ? "attention" : "neutral"}
                  >
                    {e.priority === "highest"
                      ? "Highest priority"
                      : e.priority === "other"
                        ? "Other assessed priority"
                        : "Assessment needed"}
                  </Badge>
                </div>
                <p className="mt-2">
                  {STATUS_LABEL[e.status]} ·{" "}
                  {e.acknowledged_at
                    ? "Dispatcher acknowledged"
                    : "Awaiting dispatcher acknowledgement"}
                </p>
                {e.description && <p className="mt-2">{e.description}</p>}
                {e.landmark && (
                  <p className="mt-1 text-sm">
                    Location landmark: {e.landmark}
                  </p>
                )}
                <p className="mt-2 text-sm text-ink-soft">
                  Reported {dateTime(e.reported_at)} ·{" "}
                  {Math.max(
                    0,
                    Math.floor(
                      (Date.now() - Date.parse(e.reported_at)) / 60000,
                    ),
                  )}{" "}
                  min since report · {e.source}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <button
          type="button"
          disabled={pages >= 10}
          onClick={() => setPages((value) => value + 1)}
          className="min-h-11 rounded border border-line px-4"
        >
          {pages >= 10
            ? "500 records loaded — narrow the operational worklist"
            : "Load more reports"}
        </button>
      )}
    </div>
  );
}
