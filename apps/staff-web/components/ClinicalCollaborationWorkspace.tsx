"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  api,
  errorMessage,
  idem,
  type Page,
  type ProviderCollaborator,
  type ProviderClinicalCase,
  type ProviderClinicalCollaboration,
} from "@/lib/api";
import { dateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Notice,
  PageHeader,
  PageShell,
  areaClass,
  inputClass,
} from "./ui";
const readable = (value: string) => value.replace(/_/g, " ");
const statusLabel = {
  requested: "Awaiting response",
  accepted: "Active collaboration",
  declined: "Declined",
  revoked: "Access ended",
  expired: "Expired",
};
export function ClinicalCollaborationWorkspace() {
  const { data, status } = useSession();
  if (status === "loading")
    return <p role="status">Verifying clinical access…</p>;
  if (status !== "authenticated" || data?.user?.role !== "clinician")
    return (
      <Notice>
        Sign in with an authorized clinician account to access collaboration.
      </Notice>
    );
  return <Workspace key={data.user.id} />;
}
function Workspace() {
  const [cases, setCases] = useState<ProviderClinicalCase[]>([]),
    [caseCursor, setCaseCursor] = useState<string | null>(null),
    [rows, setRows] = useState<ProviderClinicalCollaboration[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [view, setView] = useState("incoming"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ProviderClinicalCase | null>(null),
    [eligible, setEligible] = useState<ProviderCollaborator[]>([]),
    [invitee, setInvitee] = useState(""),
    [question, setQuestion] = useState(""),
    [hours, setHours] = useState("168");
  const [loading, setLoading] = useState(true),
    [checking, setChecking] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [checkedAt, setCheckedAt] = useState<string | null>(null);
  const revision = useRef(0),
    eligibility = useRef(0),
    lock = useRef(false),
    attempt = useRef<{
      body: string;
      expiresAt: string;
      options: ReturnType<typeof idem>;
    }>();
  const load = useCallback(
    async (next?: string) => {
      const run = ++revision.current;
      setLoading(true);
      setError(null);
      try {
        const response = await api.get<Page<ProviderClinicalCollaboration>>(
          "/network/collaborations",
          { params: { limit: 25, view, q: search || undefined, cursor: next } },
        );
        if (run !== revision.current) return;
        setRows((current) =>
          next
            ? Array.from(
                new Map(
                  [...current, ...response.data.data].map((row) => [
                    row.id,
                    row,
                  ]),
                ).values(),
              )
            : response.data.data,
        );
        setCursor(response.data.meta?.next_cursor ?? null);
        setCheckedAt(new Date().toISOString());
      } catch (cause) {
        if (run === revision.current) {
          setRows([]);
          setCursor(null);
          setError(
            errorMessage(
              cause,
              "Collaboration requests could not be confirmed. Refresh to try again.",
            ),
          );
        }
      } finally {
        if (run === revision.current) setLoading(false);
      }
    },
    [view, search],
  );
  useEffect(() => {
    setRows([]);
    setCursor(null);
    void load();
    return () => {
      revision.current++;
    };
  }, [load]);
  const caseRevision = useRef(0);
  async function loadCases(next?: string) {
    const run = ++caseRevision.current;
    try {
      const response = await api.get<Page<ProviderClinicalCase>>(
        "/network/collaborations/cases",
        { params: { limit: 25, cursor: next } },
      );
      if (run !== caseRevision.current) return;
      setCases((current) =>
        next ? [...current, ...response.data.data] : response.data.data,
      );
      setCaseCursor(response.data.meta?.next_cursor ?? null);
    } catch (cause) {
      if (run === caseRevision.current) {
        setCases([]);
        setError(
          errorMessage(
            cause,
            "Your eligible cases could not be loaded. Refresh to try again.",
          ),
        );
      }
    }
  }
  useEffect(() => {
    void loadCases();
    return () => {
      caseRevision.current++;
      eligibility.current++;
    };
  }, []);
  function close() {
    eligibility.current++;
    setSelected(null);
    setEligible([]);
    setInvitee("");
    setChecking(false);
  }
  async function select(item: ProviderClinicalCase) {
    const run = ++eligibility.current;
    setSelected(item);
    setEligible([]);
    setInvitee("");
    setQuestion("");
    setChecking(true);
    setNotice(null);
    setError(null);
    try {
      const response = await api.get<{ data: ProviderCollaborator[] }>(
        "/network/collaborations/eligible-clinicians",
        { params: { consultation_id: item.consultation_id } },
      );
      if (run !== eligibility.current) return;
      setEligible(response.data.data);
    } catch (cause) {
      if (run === eligibility.current)
        setError(
          errorMessage(
            cause,
            "Patient-authorized clinicians could not be checked. Select the case again to retry.",
          ),
        );
    } finally {
      if (run === eligibility.current) setChecking(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !selected || !invitee || checking || !question.trim())
      return;
    const recipient = eligible.find(
      (person) => person.clinician_id === invitee,
    );
    if (
      !recipient ||
      !window.confirm(
        `Send this clinical question to ${recipient.full_name ?? "the selected clinician"} for this consultation only?`,
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const data = {
      consultation_id: selected.consultation_id,
      invited_clinician_id: invitee,
      question: question.trim(),
      expires_at: new Date(Date.now() + Number(hours) * 3600000).toISOString(),
    };
    // Preserve the exact request, including expiry, for an uncertain retry.
    const fingerprint = JSON.stringify({ ...data, expires_at: hours });
    if (attempt.current?.body !== fingerprint)
      attempt.current = {
        body: fingerprint,
        expiresAt: data.expires_at,
        options: idem(),
      };
    const expiry = attempt.current.expiresAt,
      options = attempt.current.options;
    try {
      await api.post(
        "/network/collaborations",
        { ...data, expires_at: expiry },
        options,
      );
      attempt.current = undefined;
      close();
      setNotice(
        "Request sent. The named clinician must accept before the shared summary and discussion open.",
      );
      setView("sent");
      if (view === "sent") await load();
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          "The request could not be confirmed. Refresh the sent list before retrying.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function decide(
    item: ProviderClinicalCollaboration,
    action: "accept" | "decline" | "revoke",
  ) {
    if (lock.current) return;
    if (
      !window.confirm(
        action === "accept"
          ? "Accept access to this consultation summary and its provider discussion?"
          : action === "decline"
            ? "Decline this collaboration request?"
            : "End access to this shared summary and discussion?",
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/network/collaborations/${item.id}/${action}`,
        { base_version: item.version },
        idem(),
      );
      setNotice(
        action === "accept"
          ? "Collaboration accepted. Open the case discussion to continue."
          : action === "decline"
            ? "Request declined."
            : "Collaboration access ended.",
      );
      await load();
    } catch (cause) {
      setRows([]);
      setError(
        errorMessage(
          cause,
          "The request changed or access is no longer active. Refresh before taking another action.",
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
        title="Clinical collaboration"
        lede="Coordinate a focused consultation with a named, patient-authorized clinician. Keep the clinical question, shared context and discussion together."
        action={
          <Button
            variant="quiet"
            disabled={loading || busy}
            onClick={() => {
              void load();
              void loadCases();
            }}
          >
            Refresh workspace
          </Button>
        }
      />
      {error && <Notice>{error}</Notice>}
      {notice && (
        <p role="status" className="rounded-lg border border-line bg-white p-4">
          {notice}
        </p>
      )}
      <section className="space-y-4" aria-label="Collaboration worklist">
        <div className="flex flex-wrap gap-2">
          {[
            ["incoming", "Incoming requests"],
            ["sent", "Sent requests"],
            ["active", "Active discussions"],
            ["closed", "Closed"],
            ["all", "All requests"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={busy}
              aria-pressed={view === value}
              className={`min-h-11 rounded-lg border px-4 py-2 text-sm ${value === view ? "border-petrol bg-petrol text-white" : "border-line bg-white"}`}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(query.trim());
            if (search === query.trim()) void load();
          }}
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor="collaboration-search"
              className="mb-2 block text-sm font-medium"
            >
              Find clinician or case
            </label>
            <input
              id="collaboration-search"
              className={inputClass}
              type="search"
              maxLength={100}
              value={query}
              disabled={busy}
              placeholder="Clinician name, consultation ID or collaboration ID"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button disabled={busy || loading}>Search</Button>
        </form>
        <p className="text-sm text-ink-soft" aria-live="polite">
          {loading
            ? "Loading requests…"
            : `${rows.length} loaded requests${checkedAt ? ` · checked ${dateTime(checkedAt)}` : ""}.`}{" "}
          Search and filters apply before pagination.
        </p>
        {!loading && !error && !rows.length && (
          <Empty>No collaboration requests match this worklist.</Empty>
        )}
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {rows.map((item) => {
            const other =
              item.viewer_role === "requester" ? item.invited : item.requester;
            return (
              <li key={item.id} className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="break-words font-semibold">
                      {other.full_name ?? "Clinician"}{" "}
                      <span className="font-normal text-ink-soft">
                        · {readable(other.specialty)}
                      </span>
                    </h2>
                    <p className="mt-1 text-sm text-ink-soft">
                      {other.facility_name ?? "Facility unlisted"}
                      {other.department_name
                        ? ` / ${other.department_name}`
                        : ""}
                    </p>
                  </div>
                  <Badge
                    tone={
                      item.status === "accepted"
                        ? "good"
                        : item.status === "requested"
                          ? "attention"
                          : "neutral"
                    }
                  >
                    {statusLabel[item.status]}
                  </Badge>
                </div>
                {item.question && (
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {item.question}
                  </p>
                )}
                <dl className="grid gap-2 text-sm text-ink-soft sm:grid-cols-2">
                  <div>
                    Case reference:{" "}
                    <span className="break-all">{item.consultation_id}</span>
                  </div>
                  <div>
                    {item.viewer_role === "invitee" ? "Received" : "Sent"}{" "}
                    {dateTime(item.requested_at)} · expires{" "}
                    {dateTime(item.expires_at)}
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  {item.status === "requested" &&
                    item.viewer_role === "invitee" && (
                      <>
                        <Button
                          disabled={busy || loading}
                          onClick={() => void decide(item, "accept")}
                        >
                          Accept collaboration
                        </Button>
                        <Button
                          variant="quiet"
                          disabled={busy || loading}
                          onClick={() => void decide(item, "decline")}
                        >
                          Decline request
                        </Button>
                      </>
                    )}
                  {item.status === "requested" &&
                    item.viewer_role === "requester" && (
                      <Button
                        variant="quiet"
                        disabled={busy || loading}
                        onClick={() => void decide(item, "revoke")}
                      >
                        Withdraw request
                      </Button>
                    )}
                  {item.status === "accepted" && (
                    <Link
                      className="ahp-view-link"
                      href={`/doctor/clinical-collaboration/${item.id}`}
                    >
                      Open case discussion
                    </Link>
                  )}
                  {!["requested", "accepted"].includes(item.status) && (
                    <p className="text-sm text-ink-soft">
                      Shared clinical content is no longer available here.
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {cursor && (
          <Button
            variant="quiet"
            disabled={loading || busy}
            onClick={() => void load(cursor)}
          >
            Load more requests
          </Button>
        )}
      </section>
      <section className="space-y-4 border-t border-line pt-6">
        <h2 className="text-xl font-semibold">Request a clinical opinion</h2>
        <p className="text-sm text-ink-soft">
          Choose a case you manage, then select a clinician with active
          individual consent for that exact care thread.
        </p>
        <Field label="Case to discuss" htmlFor="collaboration-case">
          <select
            id="collaboration-case"
            className={inputClass}
            value={selected?.consultation_id ?? ""}
            disabled={busy}
            onChange={(event) => {
              const item = cases.find(
                (row) => row.consultation_id === event.target.value,
              );
              if (item) void select(item);
              else close();
            }}
          >
            <option value="">Select one of my cases</option>
            {cases.map((item) => (
              <option key={item.consultation_id} value={item.consultation_id}>
                {readable(item.urgency_level)} ·{" "}
                {item.case_summary?.slice(0, 90) ?? item.consultation_id}
              </option>
            ))}
          </select>
        </Field>
        {caseCursor && (
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => void loadCases(caseCursor)}
          >
            Load more cases
          </Button>
        )}
        {selected && (
          <Card className="space-y-4">
            <div className="flex flex-wrap justify-between gap-3">
              <h3 className="font-semibold">Prepare collaboration request</h3>
              <Button variant="quiet" disabled={busy} onClick={close}>
                Close request
              </Button>
            </div>
            <p className="break-all text-sm text-ink-soft">
              Case {selected.consultation_id} · {readable(selected.status)}
            </p>
            {selected.case_summary && (
              <details>
                <summary className="cursor-pointer font-medium">
                  Review case context
                </summary>
                <p className="mt-3 whitespace-pre-wrap break-words">
                  {selected.case_summary}
                </p>
              </details>
            )}
            {checking ? (
              <p role="status">Checking patient-authorized clinicians…</p>
            ) : !eligible.length ? (
              <Notice>
                No eligible named clinician is available. Ask the patient to
                grant case-scoped consent, then select the case again to check.
              </Notice>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <Field
                  label="Patient-authorized clinician"
                  htmlFor="collaboration-clinician"
                >
                  <select
                    id="collaboration-clinician"
                    className={inputClass}
                    required
                    value={invitee}
                    disabled={busy}
                    onChange={(event) => setInvitee(event.target.value)}
                  >
                    <option value="">Choose the clinician explicitly</option>
                    {eligible.map((person) => (
                      <option
                        key={person.clinician_id}
                        value={person.clinician_id}
                      >
                        {person.full_name ?? "Clinician"} ·{" "}
                        {readable(person.specialty)} ·{" "}
                        {person.facility_name ?? "Facility unlisted"}
                        {person.department_name
                          ? ` / ${person.department_name}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Clinical question / requested input"
                  htmlFor="collaboration-question"
                  hint="State the question, relevant findings and the input you need. Free text is not automatically de-identified."
                >
                  <textarea
                    id="collaboration-question"
                    className={areaClass}
                    rows={5}
                    maxLength={4000}
                    required
                    disabled={busy}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                  />
                </Field>
                <Field
                  label="Maximum access duration"
                  htmlFor="collaboration-duration"
                >
                  <select
                    id="collaboration-duration"
                    className={inputClass}
                    value={hours}
                    disabled={busy}
                    onChange={(event) => setHours(event.target.value)}
                  >
                    <option value="24">24 hours</option>
                    <option value="72">3 days</option>
                    <option value="168">7 days</option>
                  </select>
                </Field>
                <p className="text-sm text-ink-soft">
                  Access ends earlier if the exact patient consent expires or is
                  revoked. Acceptance opens only this consultation summary and a
                  separate provider discussion; it does not transfer care
                  ownership or create a signed clinical note.
                </p>
                <Button disabled={busy || !invitee || !question.trim()}>
                  {busy ? "Sending…" : "Review and send request"}
                </Button>
              </form>
            )}
          </Card>
        )}
      </section>
    </PageShell>
  );
}
