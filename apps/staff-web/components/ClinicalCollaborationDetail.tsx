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
import { isAxiosError } from "axios";
import {
  api,
  errorMessage,
  idem,
  type Page,
  type ProviderClinicalCollaboration,
  type ProviderClinicalCollaborationMessage as Message,
  type ProviderClinicalCase,
} from "@/lib/api";
import { mergeMessages } from "@/lib/messageOrder";
import { dateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Empty,
  Notice,
  PageHeader,
  PageShell,
  areaClass,
} from "./ui";
interface SharedCase {
  collaboration_id: string;
  scope: "consultation_summary";
  viewer_role: "requester" | "invitee";
  case: ProviderClinicalCase;
}
export function ClinicalCollaborationDetail({
  collaborationId,
}: {
  collaborationId: string;
}) {
  const { data, status } = useSession();
  if (status === "loading")
    return <p role="status">Verifying clinical access…</p>;
  if (status !== "authenticated" || data?.user?.role !== "clinician")
    return (
      <Notice>
        Sign in with an authorized clinician account to access this discussion.
      </Notice>
    );
  return (
    <Discussion key={data.user.id + collaborationId} id={collaborationId} />
  );
}
function Discussion({ id }: { id: string }) {
  const [collaboration, setCollaboration] =
      useState<ProviderClinicalCollaboration | null>(null),
    [shared, setShared] = useState<SharedCase | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [body, setBody] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [checked, setChecked] = useState<string | null>(null);
  const revision = useRef(0),
    lock = useRef(false),
    history = useRef(false),
    loadingRef = useRef(true),
    active = useRef<ProviderClinicalCollaboration | null>(null),
    attempt = useRef<{ body: string; key: string }>();
  loadingRef.current = loading;
  active.current = collaboration;
  function clearClinical(clearDraft = false) {
    setShared(null);
    setMessages([]);
    setCursor(null);
    history.current = false;
    if (clearDraft) {
      setBody("");
      attempt.current = undefined;
    }
  }
  const load = useCallback(
    async (quiet = false) => {
      const run = ++revision.current;
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const response = await api.get<ProviderClinicalCollaboration>(
          `/network/collaborations/${id}`,
        );
        const row = response.data;
        if (
          row.status === "accepted" &&
          Date.parse(row.expires_at) > Date.now()
        ) {
          const [context, discussion] = await Promise.all([
            api.get<SharedCase>(`/network/collaborations/${id}/case`),
            history.current
              ? Promise.resolve(null)
              : api.get<Page<Message>>(
                  `/network/collaborations/${id}/messages`,
                  { params: { order: "latest", limit: 50 } },
                ),
          ]);
          if (run !== revision.current) return;
          if (Date.parse(row.expires_at) <= Date.now()) {
            clearClinical(true);
            setCollaboration({ ...row, status: "expired", question: null });
            return;
          }
          setCollaboration(row);
          setShared(context.data);
          if (discussion) {
            setMessages(mergeMessages([], discussion.data.data));
            setCursor(discussion.data.meta?.next_cursor ?? null);
          }
        } else {
          if (run !== revision.current) return;
          setCollaboration(row);
          clearClinical(true);
        }
        if (run === revision.current) setChecked(new Date().toISOString());
      } catch (cause) {
        if (run !== revision.current) return;
        setCollaboration(null);
        clearClinical(
          isAxiosError(cause) &&
            [401, 403, 404].includes(cause.response?.status ?? 0),
        );
        setError(
          errorMessage(
            cause,
            "Discussion access could not be verified. Refresh to try again.",
          ),
        );
      } finally {
        if (run === revision.current) setLoading(false);
      }
    },
    [id],
  );
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [load]);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(async () => {
        if (
          !stop &&
          document.visibilityState === "visible" &&
          !lock.current &&
          !loadingRef.current
        )
          await load(true);
        if (!stop) tick();
      }, 15000);
    };
    tick();
    const resume = () => {
      if (document.visibilityState === "visible" && !lock.current) {
        setShared(null);
        setMessages([]);
        history.current = false;
        void load();
      }
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [load]);
  useEffect(() => {
    if (
      !collaboration ||
      !["accepted", "requested"].includes(collaboration.status)
    )
      return;
    const expiry = Date.parse(collaboration.expires_at);
    const wait = Math.min(2147483647, Math.max(0, expiry - Date.now()));
    const timer = setTimeout(() => {
      revision.current++;
      clearClinical(true);
      setCollaboration((row) =>
        row ? { ...row, status: "expired", question: null } : null,
      );
      void load();
    }, wait);
    return () => clearTimeout(timer);
  }, [collaboration?.expires_at, collaboration?.status, load]);
  async function earlier() {
    if (lock.current || !cursor) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const run = ++revision.current;
    try {
      const response = await api.get<Page<Message>>(
        `/network/collaborations/${id}/messages`,
        { params: { limit: 50, order: "latest", cursor } },
      );
      if (run !== revision.current) return;
      history.current = true;
      setMessages((current) => mergeMessages(current, response.data.data));
      setCursor(response.data.meta?.next_cursor ?? null);
    } catch (cause) {
      if (run === revision.current) {
        setCollaboration(null);
        clearClinical(true);
        setError(
          errorMessage(
            cause,
            "Earlier discussion could not be verified. Refresh to check access.",
          ),
        );
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (
      lock.current ||
      loading ||
      !shared ||
      !text ||
      Date.parse(active.current?.expires_at ?? "") <= Date.now()
    )
      return;
    revision.current++;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (attempt.current?.body !== text)
      attempt.current = { body: text, key: crypto.randomUUID() };
    try {
      const response = await api.post<Message>(
        `/network/collaborations/${id}/messages`,
        { body: text, client_message_id: attempt.current.key },
        idem(),
      );
      setBody("");
      attempt.current = undefined;
      setNotice(
        "Message saved to this provider discussion. Delivery does not establish that it has been read.",
      );
      if (Date.parse(active.current?.expires_at ?? "") > Date.now())
        setMessages((current) => mergeMessages(current, [response.data]));
      else clearClinical(true);
    } catch (cause) {
      if (
        isAxiosError(cause) &&
        [401, 403, 404].includes(cause.response?.status ?? 0)
      ) {
        clearClinical(true);
        setCollaboration(null);
      }
      setError(
        errorMessage(
          cause,
          "Message could not be confirmed. Retry unchanged text to reuse the same message reference.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function revoke() {
    const row = active.current;
    if (
      lock.current ||
      !row ||
      !window.confirm(
        "End access to this consultation summary and provider discussion for both participants?",
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<ProviderClinicalCollaboration>(
        `/network/collaborations/${id}/revoke`,
        { base_version: row.version },
        idem(),
      );
      revision.current++;
      clearClinical(true);
      setCollaboration(response.data);
      setNotice("Collaboration access has ended.");
    } catch (cause) {
      clearClinical(true);
      setCollaboration(null);
      setError(
        errorMessage(
          cause,
          "Access status could not be confirmed. Refresh before continuing.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const other =
    collaboration?.viewer_role === "requester"
      ? collaboration.invited
      : collaboration?.requester;
  const currentId =
    collaboration?.viewer_role === "requester"
      ? collaboration.requester.clinician_id
      : collaboration?.invited.clinician_id;
  const symptoms = shared?.case.structured_symptoms;
  const symptomRows = Array.isArray(symptoms) ? symptoms : [];
  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="Clinical case discussion"
        lede="A focused, patient-authorized exchange between the requesting clinician and the named collaborator."
        action={
          <Button
            variant="quiet"
            disabled={busy || loading}
            onClick={() => {
              history.current = false;
              clearClinical();
              void load();
            }}
          >
            Refresh discussion
          </Button>
        }
      />
      <Link
        href="/doctor/clinical-collaboration"
        className="inline-flex min-h-11 items-center text-petrol underline underline-offset-4"
      >
        Back to collaboration worklist
      </Link>
      {error && <Notice>{error}</Notice>}
      {notice && (
        <p role="status" className="rounded-lg border border-line bg-white p-4">
          {notice}
        </p>
      )}
      {loading && <p role="status">Verifying discussion access…</p>}
      {!loading && collaboration && (
        <>
          <section
            className="space-y-4 rounded-xl border border-line bg-white p-5"
            aria-label="Collaboration details"
          >
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {other?.full_name ?? "Clinician"}
                </h2>
                <p className="mt-1 text-sm text-ink-soft">
                  {other?.specialty.replace(/_/g, " ")} ·{" "}
                  {other?.facility_name ?? "Facility unlisted"}
                  {other?.department_name ? ` / ${other.department_name}` : ""}
                </p>
              </div>
              <Badge
                tone={collaboration.status === "accepted" ? "good" : "neutral"}
              >
                {collaboration.status === "accepted"
                  ? "Active collaboration"
                  : collaboration.status === "revoked"
                    ? "Access ended"
                    : collaboration.status}
              </Badge>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-soft">Case reference</dt>
                <dd className="break-all">{collaboration.consultation_id}</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Access boundary</dt>
                <dd>Consultation summary and provider discussion</dd>
              </div>
              <div>
                <dt className="text-ink-soft">Requested / accepted</dt>
                <dd>
                  {dateTime(collaboration.requested_at)} /{" "}
                  {dateTime(collaboration.responded_at)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-soft">Access expires</dt>
                <dd>{dateTime(collaboration.expires_at)}</dd>
              </div>
            </dl>
            {collaboration.question && (
              <div className="border-t border-line pt-4">
                <h3 className="font-semibold">Clinical question</h3>
                <p className="mt-2 whitespace-pre-wrap break-words">
                  {collaboration.question}
                </p>
              </div>
            )}
          </section>
          {shared && collaboration.status === "accepted" ? (
            <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.4fr)]">
              <aside className="min-w-0 space-y-4 rounded-xl border border-line bg-white p-5">
                <h2 className="text-lg font-semibold">Shared case context</h2>
                <p className="text-sm text-ink-soft">
                  {shared.case.urgency_level.replace(/_/g, " ")} ·{" "}
                  {shared.case.status.replace(/_/g, " ")} ·{" "}
                  {dateTime(shared.case.created_at)}
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {shared.case.case_summary ??
                    "No narrative summary was recorded."}
                </p>
                {symptomRows.length > 0 && (
                  <details>
                    <summary className="cursor-pointer font-medium">
                      Recorded symptom details
                    </summary>
                    <ul className="mt-3 space-y-3 text-sm">
                      {symptomRows.map((symptom, index) => (
                        <li key={index} className="border-t border-line pt-2">
                          {symptom && typeof symptom === "object"
                            ? Object.entries(symptom)
                                .filter(([, value]) =>
                                  ["string", "number", "boolean"].includes(
                                    typeof value,
                                  ),
                                )
                                .map(([key, value]) => (
                                  <p key={key} className="break-words">
                                    <span className="text-ink-soft">
                                      {key.replace(/_/g, " ")}:{" "}
                                    </span>
                                    {String(value)}
                                  </p>
                                ))
                            : String(symptom)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <p className="border-t border-line pt-4 text-sm text-ink-soft">
                  This share does not open the longitudinal record,
                  prescriptions, signed notes or the patient’s care-thread chat.
                  Do not treat discussion messages as signed clinical orders.
                </p>
                <Button
                  variant="danger"
                  disabled={busy || loading}
                  onClick={() => void revoke()}
                >
                  End collaboration access
                </Button>
              </aside>
              <section
                className="min-w-0 space-y-4"
                aria-label="Clinician discussion"
              >
                <div>
                  <h2 className="text-xl font-semibold">Provider discussion</h2>
                  <p className="mt-1 text-sm text-ink-soft">
                    {checked
                      ? `Access last checked ${dateTime(checked)}. `
                      : ""}
                    {history.current
                      ? "Earlier history is open; access checks continue. Refresh to load the latest messages."
                      : "Recent messages refresh every 15 seconds while visible."}
                  </p>
                </div>
                {cursor && (
                  <Button
                    variant="quiet"
                    disabled={busy || loading}
                    onClick={() => void earlier()}
                  >
                    Load earlier messages
                  </Button>
                )}
                {!messages.length ? (
                  <Empty>
                    No provider messages yet. Start with the clinical input
                    requested above.
                  </Empty>
                ) : (
                  <ol className="space-y-3">
                    {messages.map((message) => {
                      const own = message.author_clinician_id === currentId;
                      const author =
                        message.author_clinician_id ===
                        collaboration.requester.clinician_id
                          ? collaboration.requester
                          : collaboration.invited;
                      return (
                        <li
                          key={message.id}
                          className={`min-w-0 rounded-xl border border-line p-4 ${own ? "bg-paper-sunk sm:ml-8" : "bg-white sm:mr-8"}`}
                        >
                          <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
                            <span className="font-semibold">
                              {author.full_name ?? "Clinician"}
                              {own ? " · You" : ""}
                            </span>
                            <time
                              className="text-ink-soft"
                              dateTime={message.created_at}
                            >
                              {dateTime(message.created_at)}
                            </time>
                          </div>
                          <p className="whitespace-pre-wrap break-words">
                            {message.body}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                )}
                <form
                  onSubmit={send}
                  className="space-y-3 rounded-xl border border-line bg-white p-4"
                >
                  <label
                    htmlFor="provider-collaboration-message"
                    className="block font-medium"
                  >
                    Reply to the collaborating clinician
                  </label>
                  <textarea
                    id="provider-collaboration-message"
                    className={areaClass}
                    rows={5}
                    maxLength={8000}
                    disabled={busy}
                    required
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm text-ink-soft">
                      {body.length}/8000 characters · provider discussion only
                    </span>
                    <Button disabled={busy || !body.trim()}>
                      {busy ? "Saving…" : "Send message"}
                    </Button>
                  </div>
                </form>
              </section>
            </div>
          ) : (
            <Notice>
              Clinical context and discussion are unavailable until this request
              is accepted and its exact patient authorization is active.
            </Notice>
          )}
        </>
      )}
    </PageShell>
  );
}
