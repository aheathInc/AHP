"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSession } from "next-auth/react";
import { api, errorMessage, idem, type Discussion, type Page } from "@/lib/api";
import { dateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Empty,
  Field,
  Notice,
  PageHeader,
  PageShell,
  areaClass,
  inputClass,
} from "./ui";
import s from "./network.module.css";
type Mode = "all" | "replies" | "muted";
interface Group {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  is_member: boolean;
  notification_mode: Mode | null;
}
interface Notification {
  id: string;
  kind: string;
  title: string;
  group_name: string;
  href: string;
  read_at: string | null;
  created_at: string;
}
export function ProfessionalNetwork() {
  const { data, status } = useSession();
  if (status === "loading")
    return <p role="status">Verifying professional access…</p>;
  if (status !== "authenticated" || data?.user?.role !== "clinician")
    return (
      <Notice>
        Sign in with a verified clinician account to access the professional
        network.
      </Notice>
    );
  return <Network key={data.user.id} />;
}
function Network() {
  const [groupsOpen, setGroupsOpen] = useState(true);
  useEffect(() => {
    const media = window.matchMedia("(max-width:850px)");
    const adapt = () => setGroupsOpen(!media.matches);
    adapt();
    media.addEventListener("change", adapt);
    return () => media.removeEventListener("change", adapt);
  }, []);

  const [groups, setGroups] = useState<Group[]>([]),
    [posts, setPosts] = useState<Discussion[]>([]),
    [selected, setSelected] = useState(""),
    [view, setView] = useState("all"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [notifications, setNotifications] = useState<{
    data: Notification[];
    unread_count: number;
    meta?: { next_cursor?: string | null };
  }>({ data: [], unread_count: 0 });
  const [loading, setLoading] = useState(true),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [checked, setChecked] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState(false),
    [groupId, setGroupId] = useState(""),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [review, setReview] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const request = useRef<{ signature: string; key: string }>(),
    epoch = useRef(0),
    lock = useRef(false),
    loadingRef = useRef(true),
    countRef = useRef(0);
  loadingRef.current = loading;
  countRef.current = posts.length;
  const load = useCallback(
    async (next?: string) => {
      const run = ++epoch.current;
      setLoading(true);
      setError(null);
      setFailed(false);
      try {
        const [g, d, n] = await Promise.all([
          api.get<{ data: Group[] }>("/network/communities"),
          api.get<Page<Discussion>>("/network/discussions", {
            params: {
              limit: 30,
              community_id: selected || undefined,
              q: search || undefined,
              view,
              cursor: next,
            },
          }),
          api.get<typeof notifications>("/network/notifications"),
        ]);
        if (run !== epoch.current) return;
        setGroups(g.data.data);
        setPosts((current) =>
          next
            ? Array.from(
                new Map(
                  [...current, ...d.data.data].map((post) => [post.id, post]),
                ).values(),
              )
            : d.data.data,
        );
        setCursor(d.data.meta?.next_cursor ?? null);
        setNotifications(n.data);
        setChecked(new Date().toISOString());
      } catch (cause) {
        if (run === epoch.current) {
          setPosts([]);
          setGroups([]);
          setNotifications({ data: [], unread_count: 0 });
          setCursor(null);
          setOpen(false);
          setBody("");
          setTitle("");
          setConfirmed(false);
          request.current = undefined;
          setFailed(true);
          setError(
            errorMessage(
              cause,
              "Professional network access could not be confirmed. Refresh to try again.",
            ),
          );
        }
      } finally {
        if (run === epoch.current) setLoading(false);
      }
    },
    [selected, search, view],
  );
  useEffect(() => {
    setPosts([]);
    setCursor(null);
    void load();
    return () => {
      epoch.current++;
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
          !loadingRef.current &&
          countRef.current <= 30
        )
          await load();
        if (!stop) tick();
      }, 30000);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [load]);
  async function membership(group: Group, mode?: Mode) {
    if (lock.current) return;
    if (
      !mode &&
      !window.confirm(
        `Leave ${group.name}? You will lose group access and notifications. Your existing contributions remain unless withdrawn or moderated.`,
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (mode)
        await api.put(`/network/communities/${group.id}/membership`, {
          notification_mode: mode,
        });
      else await api.delete(`/network/communities/${group.id}/membership`);
      setNotice(
        mode
          ? `${group.name}: membership and notification preference saved.`
          : `You left ${group.name}.`,
      );
      if (!mode && groupId === group.id) {
        setOpen(false);
        setBody("");
        setTitle("");
        request.current = undefined;
      }
      if (!mode && selected === group.id) setSelected("");
      else await load();
    } catch (cause) {
      setError(errorMessage(cause, "Group membership could not be updated."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!review || !confirmed || lock.current) return;
    const input = {
      community_id: groupId,
      title: title.trim(),
      body: body.trim(),
    };
    if (
      !input.title ||
      !input.body ||
      !groups.some((group) => group.id === groupId && group.is_member)
    )
      return;
    lock.current = true;
    epoch.current++;
    setLoading(false);
    setBusy(true);
    setError(null);
    const signature = JSON.stringify(input);
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    try {
      const response = await api.post<Discussion>(
        "/network/discussions",
        {
          ...input,
          client_request_id: request.current.key,
          privacy_confirmed: true,
        },
        idem(),
      );
      request.current = undefined;
      setOpen(false);
      setReview(false);
      setConfirmed(false);
      setTitle("");
      setBody("");
      setNotice(
        response.data.moderation_status === "hidden"
          ? "This contribution is no longer visible to the group."
          : "Discussion published to the selected group.",
      );
      if (selected !== groupId) setSelected(groupId);
      else await load();
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          "Publication could not be confirmed. Retry the unchanged draft to reuse its reference.",
        ),
      );
      const status = (cause as { response?: { status: number } }).response
        ?.status;
      if (status === 401 || status === 403) {
        setPosts([]);
        setOpen(false);
        setTitle("");
        setBody("");
        request.current = undefined;
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function moreNotifications() {
    if (lock.current || !notifications.meta?.next_cursor) return;
    lock.current = true;
    setBusy(true);
    const run = epoch.current;
    try {
      const response = await api.get<typeof notifications>(
        "/network/notifications",
        { params: { limit: 50, cursor: notifications.meta.next_cursor } },
      );
      if (run !== epoch.current) return;
      setNotifications((current) => ({
        ...response.data,
        data: Array.from(
          new Map(
            [...current.data, ...response.data.data].map((item) => [
              item.id,
              item,
            ]),
          ).values(),
        ),
      }));
    } catch (cause) {
      setNotifications({ data: [], unread_count: 0 });
      setError(
        errorMessage(
          cause,
          "More notifications could not be verified. Refresh the network.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function markRead(n: Notification) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await api.post(`/network/notifications/${n.id}/read`);
      setNotifications((current) => ({
        ...current,
        unread_count: Math.max(
          0,
          current.unread_count -
            (current.data.find((item) => item.id === n.id)?.read_at ? 0 : 1),
        ),
        data: current.data.map((item) =>
          item.id === n.id
            ? { ...item, read_at: new Date().toISOString() }
            : item,
        ),
      }));
    } catch (cause) {
      setError(errorMessage(cause, "Notification could not be marked read."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const joined = groups.filter((group) => group.is_member);
  function edit() {
    setReview(false);
    setConfirmed(false);
  }
  return (
    <PageShell className="space-y-6">
      <div className={s.workspace}>
        <PageHeader
          title="Professional network"
          lede="Exchange clinical questions, evidence and practice insights with verified colleagues. Keep group learning separate from patient-specific handoffs."
          action={
            <Button
              variant="quiet"
              disabled={loading || busy}
              onClick={() => void load()}
            >
              Refresh network
            </Button>
          }
        />
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-white p-4 text-sm">
          <span>
            Group posts are visible to every member. Remove direct and indirect
            patient identifiers before posting.
          </span>
          <Link
            className="font-medium text-petrol underline"
            href="/doctor/referrals"
          >
            Patient-authorized referral
          </Link>
          <Link
            className="font-medium text-petrol underline"
            href="/doctor/clinical-collaboration"
          >
            Named-clinician collaboration
          </Link>
        </div>
        {error && <Notice>{error}</Notice>}
        {notice && (
          <p
            role="status"
            className="mt-4 rounded-lg border border-line bg-white p-4"
          >
            {notice}
          </p>
        )}
        <div className={s.layout}>
          <aside className={s.sidebar}>
            <details
              className={s.groups}
              open={groupsOpen}
              onToggle={(event) => setGroupsOpen(event.currentTarget.open)}
            >
              <summary>Professional groups · {joined.length} joined</summary>
              {groups.map((group) => (
                <section key={group.id} className={s.group}>
                  <h2 className="!mb-1 !text-base">{group.name}</h2>
                  <p className="text-sm text-ink-soft">
                    {group.description ??
                      "Professional learning and peer discussion."}
                  </p>
                  <p className="mb-3 text-sm text-ink-soft">
                    {group.member_count} registered members
                  </p>
                  <Button
                    variant="quiet"
                    disabled={busy || loading}
                    onClick={() =>
                      void membership(
                        group,
                        group.is_member ? undefined : "replies",
                      )
                    }
                  >
                    {group.is_member ? "Leave group" : "Join group"}
                  </Button>
                  {group.is_member && (
                    <label>
                      Notifications for {group.name}
                      <select
                        value={group.notification_mode ?? "replies"}
                        disabled={busy || loading}
                        onChange={(event) =>
                          void membership(group, event.target.value as Mode)
                        }
                      >
                        <option value="replies">
                          Replies in discussions I contribute to
                        </option>
                        <option value="all">All group activity</option>
                        <option value="muted">Muted</option>
                      </select>
                    </label>
                  )}
                </section>
              ))}
              {!groups.length && !loading && (
                <p>
                  {failed
                    ? "Refresh to verify your group access."
                    : "No active professional groups are available."}
                </p>
              )}
              <p className="mt-4 text-sm text-ink-soft">
                Contributions are individual professional opinions. Cite
                relevant evidence and disclose relevant interests. Notifications
                are in-app; no external delivery is implied.
              </p>
            </details>
          </aside>
          <section
            className="min-w-0 space-y-5"
            aria-label="Professional discussions"
          >
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <Field label="Discussion group" htmlFor="network-group-filter">
                  <select
                    id="network-group-filter"
                    value={selected}
                    disabled={busy || failed}
                    onChange={(event) => setSelected(event.target.value)}
                  >
                    <option value="">All my joined groups</option>
                    {joined.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Button
                disabled={busy || failed || !joined.length}
                onClick={() => {
                  setGroupId(selected);
                  setOpen((value) => !value);
                  edit();
                }}
              >
                {open ? "Close composer" : "New discussion"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["all", "Recent discussions"],
                ["mine", "My contributions"],
                ["unanswered", "No replies yet"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${view === value ? "border-petrol bg-petrol text-white" : "border-line bg-white"}`}
                  disabled={busy}
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
                  htmlFor="network-search"
                  className="mb-2 block text-sm font-medium"
                >
                  Search joined-group discussions
                </label>
                <input
                  id="network-search"
                  type="search"
                  maxLength={100}
                  placeholder="Clinical question, topic or evidence"
                  value={query}
                  disabled={busy}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Button disabled={loading || busy}>Search</Button>
            </form>
            <p className="text-sm text-ink-soft" aria-live="polite">
              {loading
                ? "Checking network…"
                : `${posts.length} loaded discussions${checked ? ` · checked ${dateTime(checked)}` : ""}.`}{" "}
              {posts.length > 30
                ? "Extra pages are open; refresh returns to recent discussions."
                : "Visible first-page views refresh every 30 seconds."}
            </p>
            {open && (
              <form
                onSubmit={publish}
                className="space-y-4 rounded-xl border border-line bg-white p-5"
              >
                <h2 className="text-xl font-semibold">
                  {review
                    ? "Review your group contribution"
                    : "Start a professional discussion"}
                </h2>
                {!review ? (
                  <>
                    <Field
                      label="Publishing group"
                      htmlFor="network-post-group"
                    >
                      <select
                        id="network-post-group"
                        value={groupId}
                        required
                        disabled={busy}
                        onChange={(event) => {
                          setGroupId(event.target.value);
                          edit();
                        }}
                      >
                        <option value="">Choose the group explicitly</option>
                        {joined.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label="Discussion subject"
                      htmlFor="network-post-title"
                    >
                      <input
                        id="network-post-title"
                        required
                        maxLength={200}
                        disabled={busy}
                        value={title}
                        onChange={(event) => {
                          setTitle(event.target.value);
                          edit();
                        }}
                      />
                    </Field>
                    <Field
                      label="Clinical question / contribution"
                      htmlFor="network-post-body"
                    >
                      <textarea
                        id="network-post-body"
                        rows={7}
                        required
                        maxLength={8000}
                        disabled={busy}
                        value={body}
                        onChange={(event) => {
                          setBody(event.target.value);
                          edit();
                        }}
                      />
                    </Field>
                    <Button
                      variant="quiet"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !body.trim() ||
                          window.confirm(
                            "Replace this draft with an empty clinical-question outline?",
                          )
                        )
                          setBody(
                            "Clinical question:\n\nRelevant de-identified context:\n\nEvidence considered / references:\n\nInput requested:\n\nRelevant interests (if any):\n",
                          );
                      }}
                    >
                      Use clinical-question outline
                    </Button>
                    <p className="text-sm text-ink-soft">
                      Do not include names, contact details, record numbers,
                      identifiable images or combinations of details that could
                      identify a patient. This form does not automatically
                      anonymize text.
                    </p>
                    <Button
                      type="button"
                      disabled={
                        busy || !groupId || !title.trim() || !body.trim()
                      }
                      onClick={() => setReview(true)}
                    >
                      Review before publishing
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-ink-soft">
                      Publishing to{" "}
                      <strong>
                        {groups.find((group) => group.id === groupId)?.name}
                      </strong>{" "}
                      ·{" "}
                      {groups.find((group) => group.id === groupId)
                        ?.member_count ?? 0}{" "}
                      registered members
                    </p>
                    <h3 className="break-words text-lg font-semibold">
                      {title}
                    </h3>
                    <p className="whitespace-pre-wrap break-words">{body}</p>
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 !w-auto"
                        checked={confirmed}
                        disabled={busy}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      <span>
                        I have checked for patient identifiers and indirect
                        identification, checked my claims and relevant
                        interests, and understand that this is a group
                        discussion, not a clinical handoff.
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-3">
                      <Button disabled={busy || !confirmed}>
                        {busy ? "Publishing…" : "Publish to group"}
                      </Button>
                      <Button
                        variant="quiet"
                        type="button"
                        disabled={busy}
                        onClick={edit}
                      >
                        Edit draft
                      </Button>
                    </div>
                  </>
                )}
                <p className="text-right text-sm text-ink-soft">
                  {body.length}/8000 characters
                </p>
              </form>
            )}
            <details className="rounded-xl border border-line bg-white p-4">
              <summary className="min-h-11 cursor-pointer font-semibold">
                Notifications · {notifications.unread_count} unread
              </summary>
              {notifications.data.length ? (
                <ul className="divide-y divide-line">
                  {notifications.data.map((n) => (
                    <li key={n.id} className="space-y-2 py-3">
                      <Link
                        className="font-medium text-petrol underline"
                        href={n.href}
                      >
                        {n.title}
                      </Link>
                      <p className="text-sm text-ink-soft">
                        {n.group_name} · {dateTime(n.created_at)} ·{" "}
                        {n.read_at ? "Read" : "Unread"}
                      </p>
                      {!n.read_at && (
                        <Button
                          variant="quiet"
                          disabled={busy}
                          onClick={() => void markRead(n)}
                        >
                          Mark as read
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-soft">
                  {failed
                    ? "Notifications could not be verified."
                    : "No visible notifications. Preferences apply to your joined groups."}
                </p>
              )}
              {notifications.meta?.next_cursor && (
                <Button
                  variant="quiet"
                  type="button"
                  disabled={busy || loading}
                  onClick={() => void moreNotifications()}
                >
                  Load more notifications
                </Button>
              )}
            </details>
            {failed ? (
              <Notice>
                Discussion access could not be confirmed. Use Refresh network.
              </Notice>
            ) : !loading && !posts.length ? (
              <Empty>
                {joined.length
                  ? "No discussions match this group and search."
                  : "Join a professional group to read and contribute."}
              </Empty>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-white">
                {posts.map((post) => (
                  <li key={post.id} className="space-y-3 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link
                        className="break-words text-lg font-semibold text-petrol underline underline-offset-4"
                        href={`/doctor/network/${post.id}`}
                      >
                        {post.title}
                      </Link>
                      <Badge>{post.reply_count} replies</Badge>
                    </div>
                    <p className="line-clamp-3 whitespace-pre-wrap break-words">
                      {post.body}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {post.author_name ?? "Clinician"} ·{" "}
                      {
                        groups.find((group) => group.id === post.community_id)
                          ?.name
                      }{" "}
                      · {dateTime(post.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {cursor && !failed && (
              <Button
                variant="quiet"
                disabled={loading || busy}
                onClick={() => void load(cursor)}
              >
                Load more discussions
              </Button>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  );
}
