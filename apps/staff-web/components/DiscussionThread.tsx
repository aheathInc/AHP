"use client";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { NetworkReport } from "./NetworkReport";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, errorMessage, idem, type Discussion, type Page } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Button, Notice, PageHeader, PageShell } from "./ui";
import s from "./network.module.css";
import { mergeMessages } from "@/lib/messageOrder";
interface Reply {
  id: string;
  body: string;
  author_name: string;
  author_clinician_id: string;
  parent_reply_id: string | null;
  created_at: string;
  version: number;
  moderation_status?: "visible" | "hidden";
}
type Detail = Discussion & {
  community_name: string;
  viewer_clinician_id: string;
  replies: Reply[];
  replies_meta: Page<Reply>["meta"];
};
export function DiscussionThread({ discussionId }: { discussionId: string }) {
  const { data, status } = useSession();
  if (status === "loading")
    return <p role="status">Verifying professional access…</p>;
  if (status !== "authenticated" || data?.user?.role !== "clinician")
    return <Notice>Sign in with an authorized clinician account.</Notice>;
  return (
    <Thread key={data.user.id + discussionId} discussionId={discussionId} />
  );
}
function Thread({ discussionId }: { discussionId: string }) {
  const [discussion, setDiscussion] = useState<Detail | null>(null),
    [replies, setReplies] = useState<Reply[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [target, setTarget] = useState<Reply | null>(null),
    [body, setBody] = useState(""),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const epoch = useRef(0),
    lock = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null),
    request = useRef<{
      signature: string;
      key: string;
    } | null>(null);
  const load = useCallback(async () => {
    const run = ++epoch.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<Detail>(`/network/discussions/${discussionId}`);
      if (run !== epoch.current) return;
      setDiscussion(r.data);
      if (r.data.moderation_status === "hidden") {
        setBody("");
        setTarget(null);
        setConfirmed(false);
        request.current = null;
      }
      setReplies(mergeMessages([], r.data.replies));
      setCursor(r.data.replies_meta?.next_cursor ?? null);
    } catch (e) {
      if (run !== epoch.current) return;
      setDiscussion(null);
      setBody("");
      setTarget(null);
      setConfirmed(false);
      request.current = null;
      setReplies([]);
      setError(
        errorMessage(
          e,
          "Discussion unavailable. Check your group membership and refresh.",
        ),
      );
    } finally {
      if (run === epoch.current) setLoading(false);
    }
  }, [discussionId]);
  useEffect(() => {
    void load();
    return () => {
      epoch.current++;
    };
  }, [load]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (
      lock.current ||
      !confirmed ||
      !body.trim() ||
      !discussion ||
      discussion.moderation_status === "hidden"
    )
      return;
    lock.current = true;
    epoch.current++;
    setLoading(false);
    setBusy(true);
    setError(null);
    const data = {
        body: body.trim(),
        ...(target ? { parent_reply_id: target.id } : {}),
      },
      signature = JSON.stringify(data);
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    try {
      const response = await api.post<Reply>(
        `/network/discussions/${discussionId}/replies`,
        {
          ...data,
          client_reply_id: request.current.key,
          privacy_confirmed: true,
        },
        idem(),
      );
      const duplicate = replies.some((reply) => reply.id === response.data.id);
      setReplies((current) => mergeMessages(current, [response.data]));
      setDiscussion((current) =>
        current
          ? {
              ...current,
              reply_count: current.reply_count + (duplicate ? 0 : 1),
              version: (current.version ?? 1) + (duplicate ? 0 : 1),
            }
          : current,
      );
      setBody("");
      setTarget(null);
      setConfirmed(false);
      request.current = null;
      setNotice("Reply saved to this group discussion.");
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          "Reply could not be confirmed. Retry the unchanged draft to reuse its reference.",
        ),
      );
      const status = (cause as { response?: { status: number } }).response
        ?.status;
      if (status === 401 || status === 403) {
        setDiscussion(null);
        setReplies([]);
        setBody("");
        setTarget(null);
        request.current = null;
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function withdraw(reply?: Reply) {
    if (
      lock.current ||
      !discussion ||
      !window.confirm(
        "Withdraw this contribution from group view? The original record will be retained for audit and moderation.",
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/network/discussions/${discussionId}/withdraw`, {
        base_version: reply?.version ?? discussion.version,
        ...(reply ? { reply_id: reply.id } : {}),
      });
      setNotice("Contribution withdrawn from group view.");
      await load();
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          "Contribution changed or withdrawal could not be confirmed. Refresh before retrying.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function accessLost() {
    epoch.current++;
    setDiscussion(null);
    setReplies([]);
    setBody("");
    setTarget(null);
    request.current = null;
    setError("Group access could not be verified. Refresh before continuing.");
  }
  async function more() {
    if (lock.current) return;
    lock.current = true;
    const run = ++epoch.current;
    setBusy(true);
    try {
      const r = await api.get<Page<Reply>>(
        `/network/discussions/${discussionId}/replies`,
        { params: { cursor, limit: 50 } },
      );
      if (run !== epoch.current) return;
      setReplies((p) => mergeMessages(p, r.data.data));
      setCursor(r.data.meta?.next_cursor ?? null);
    } catch (e) {
      if (run === epoch.current) {
        setDiscussion(null);
        setReplies([]);
        setBody("");
        setError(
          errorMessage(
            e,
            "More replies could not be verified. Refresh to check access.",
          ),
        );
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function choose(r: Reply | null) {
    setTarget(r);
    setConfirmed(false);
    input.current?.focus();
  }
  const byId = new Map(replies.map((r) => [r.id, r]));
  function render(r: Reply, depth = 0): React.ReactNode {
    const children = replies.filter((x) => x.parent_reply_id === r.id),
      parent = r.parent_reply_id ? byId.get(r.parent_reply_id) : null;
    return (
      <li className={s.reply} key={r.id} id={`reply-${r.id}`}>
        <article>
          <header>
            <strong>{r.author_name || "Clinician"}</strong>
            <time dateTime={r.created_at}>{dateTime(r.created_at)}</time>
          </header>
          {r.parent_reply_id && (
            <p className={s.replyContext}>
              Reply to{" "}
              {parent ? (
                <a href={`#reply-${parent.id}`}>
                  {parent.author_name || "Clinician"}
                </a>
              ) : (
                "an earlier message (load more replies to view)"
              )}
            </p>
          )}
          <p>{r.body}</p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="quiet"
              disabled={busy || r.moderation_status === "hidden"}
              onClick={() => choose(r)}
            >
              Reply to {r.author_name || "clinician"}
            </Button>
            {r.moderation_status !== "hidden" && (
              <>
                <NetworkReport
                  discussionId={discussionId}
                  replyId={r.id}
                  onAccessLost={accessLost}
                />
                {discussion?.viewer_clinician_id === r.author_clinician_id && (
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => void withdraw(r)}
                  >
                    Withdraw my reply
                  </Button>
                )}
              </>
            )}
          </div>
        </article>
        {children.length > 0 && (
          <ul className={`${s.replies} ${depth >= 2 ? s.flat : ""}`}>
            {children.map((x) => render(x, depth + 1))}
          </ul>
        )}
      </li>
    );
  }
  return (
    <PageShell>
      <div className={`${s.workspace} ${s.thread}`}>
        <Link href="/doctor/network">Back to professional network</Link>
        {error && <Notice>{error}</Notice>}
        {notice && (
          <p role="status" className={s.muted}>
            {notice}
          </p>
        )}
        {loading ? (
          <p className={s.empty} role="status">
            Loading discussion…
          </p>
        ) : discussion ? (
          <>
            <PageHeader
              title={discussion.title}
              lede={`${discussion.community_name} · ${discussion.author_name ?? "Clinician"} · ${dateTime(discussion.created_at)}`}
              action={
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => void load()}
                >
                  Refresh
                </Button>
              }
            />
            <div className="rounded-xl border border-line bg-white p-5">
              <p className="whitespace-pre-wrap break-words">
                {discussion.body}
              </p>
            </div>
            {discussion.moderation_status !== "hidden" && (
              <div className="flex flex-wrap items-start gap-3">
                <NetworkReport
                  discussionId={discussionId}
                  onAccessLost={accessLost}
                />
                {discussion.viewer_clinician_id ===
                  discussion.author_clinician_id && (
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => void withdraw()}
                  >
                    Withdraw my discussion
                  </Button>
                )}
                <Link
                  className="inline-flex min-h-11 items-center text-petrol underline"
                  href="/doctor/referrals"
                >
                  Use a patient-authorized referral for handoffs
                </Link>
              </div>
            )}
            {discussion.moderation_status !== "hidden" && (
              <>
                <div id="replies" className={s.toolbar}>
                  <h2>Replies ({discussion.reply_count})</h2>
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => choose(null)}
                  >
                    Reply to discussion
                  </Button>
                </div>
                {!replies.length ? (
                  <p className={s.empty}>
                    No replies yet. Share a response with the group.
                  </p>
                ) : (
                  <ul className={s.replies}>
                    {replies
                      .filter(
                        (r) =>
                          !r.parent_reply_id || !byId.has(r.parent_reply_id),
                      )
                      .map((r) => render(r))}
                  </ul>
                )}
                {cursor && (
                  <Button
                    variant="quiet"
                    disabled={busy}
                    onClick={() => void more()}
                  >
                    Load more replies
                  </Button>
                )}
                <form className={s.composer} onSubmit={send}>
                  <h2>
                    {target
                      ? `Reply to ${target.author_name || "clinician"}`
                      : "Reply to discussion"}
                  </h2>
                  {target && (
                    <>
                      <p className={s.muted}>
                        {target.body.slice(0, 180)}
                        {target.body.length > 180 ? "…" : ""}
                      </p>
                      <Button
                        variant="quiet"
                        type="button"
                        disabled={busy}
                        onClick={() => choose(null)}
                      >
                        Cancel specific reply
                      </Button>
                    </>
                  )}
                  <label htmlFor="professional-network-reply">Your reply</label>
                  <textarea
                    id="professional-network-reply"
                    ref={input}
                    required
                    maxLength={8000}
                    rows={4}
                    value={body}
                    disabled={busy}
                    onChange={(e) => {
                      setBody(e.target.value);
                      setConfirmed(false);
                    }}
                  />
                  <p className={s.muted}>
                    All members of this group can read your reply. Keep patient
                    identifiers out of this discussion.
                  </p>
                  <label className="!flex items-start gap-3">
                    <input
                      className="!w-auto mt-1"
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>
                      I have checked that this reply contains no direct or
                      indirect patient identifiers and that my claims and
                      relevant interests are clear.
                    </span>
                  </label>
                  <p className={s.muted}>
                    {body.length}/8000 characters · No automatic anonymization
                    is performed.
                  </p>
                  <Button
                    type="submit"
                    disabled={busy || !body.trim() || !confirmed}
                  >
                    {busy ? "Posting…" : "Post reply"}
                  </Button>
                </form>
              </>
            )}
          </>
        ) : (
          <Button onClick={() => void load()}>Try again</Button>
        )}
      </div>
    </PageShell>
  );
}
