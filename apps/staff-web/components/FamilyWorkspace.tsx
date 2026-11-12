"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useSession } from "next-auth/react";
import { api, errorMessage, type Page } from "@/lib/api";
import { dateTime } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  Empty,
  Notice,
  PageHeader,
  PageShell,
  inputClass,
  areaClass,
} from "./ui";
type Family = {
  id: string;
  name: string;
  subscription_tier: string;
  version: number;
  members: { id: string; full_name: string; relationship: string }[];
  gp_clinician: { id: string; full_name: string; available: boolean } | null;
  obgyn_clinician: { id: string; full_name: string; available: boolean } | null;
};
type Plan = {
  tier: string;
  name: string;
  description: string;
  benefits: string[];
  exclusions: string[];
  price_minor: number | null;
  currency: string;
  billing_period: string;
  accepting_requests: boolean;
  version: number;
};
type RequestRow = {
  id: string;
  family_id: string;
  family_name: string;
  tier: string;
  plan_version: number;
  terms?: Plan;
  status: string;
  version: number;
  created_at: string;
  review_note: string | null;
};
type Clinician = {
  id: string;
  full_name: string;
  specialty: string;
  family_load: number;
  max_family_load: number;
};
const tierName = (tier: string) =>
  ({
    none: "No package",
    family_basic: "Family Basic",
    family_plus: "Family Plus",
  })[tier] ?? tier;
const money = (p: Plan) =>
  p.price_minor === null
    ? "Price not published"
    : new Intl.NumberFormat("en-TZ", {
        style: "currency",
        currency: p.currency,
      }).format(p.price_minor / 100);
export function FamilyWorkspace({ admin = false }: { admin?: boolean }) {
  const session = useSession();
  if (session.status === "loading")
    return <p role="status">Verifying family services access…</p>;
  if (
    session.status !== "authenticated" ||
    session.data?.user?.role !== (admin ? "platform_admin" : "clinician")
  )
    return <Notice>Authorized staff access is required.</Notice>;
  return <Workspace key={session.data.user.id} admin={admin} />;
}
function Workspace({ admin }: { admin: boolean }) {
  const [tab, setTab] = useState("families"),
    [rows, setRows] = useState<Family[]>([]),
    [plans, setPlans] = useState<Plan[]>([]),
    [requests, setRequests] = useState<RequestRow[]>([]),
    [filter, setFilter] = useState("pending"),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<Family | null>(null),
    [editing, setEditing] = useState<Plan | null>(null),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    lock = useRef(false);
  const load = useCallback(
    async (next?: string) => {
      const run = ++epoch.current;
      setLoading(true);
      setError(null);
      try {
        if (tab === "families") {
          const r = await api.get<Page<Family>>("/families", {
            params: { q: search, limit: 20, cursor: next },
          });
          if (run !== epoch.current) return;
          setRows((old) => (next ? [...old, ...r.data.data] : r.data.data));
          setCursor(r.data.meta?.next_cursor ?? null);
        } else if (tab === "packages") {
          const r = await api.get<{ data: Plan[] }>("/families/plans");
          if (run !== epoch.current) return;
          setPlans(r.data.data);
          setCursor(null);
        } else {
          const r = await api.get<Page<RequestRow>>(
            "/families/subscription-requests",
            { params: { status: filter, limit: 25, cursor: next } },
          );
          if (run !== epoch.current) return;
          setRequests((old) => (next ? [...old, ...r.data.data] : r.data.data));
          setCursor(r.data.meta?.next_cursor ?? null);
        }
      } catch (e) {
        if (run === epoch.current) {
          setRows([]);
          setPlans([]);
          setRequests([]);
          setSelected(null);
          setEditing(null);
          setCursor(null);
          setError(
            errorMessage(
              e,
              "Family services could not be verified. Refresh to try again.",
            ),
          );
        }
      } finally {
        if (run === epoch.current) setLoading(false);
      }
    },
    [tab, filter, search],
  );
  useEffect(() => {
    setSelected(null);
    setEditing(null);
    setRows([]);
    setRequests([]);
    void load();
    return () => {
      epoch.current++;
    };
  }, [load]);
  async function savePlan(input: Plan) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.put("/families/plans/" + input.tier, {
        base_version: input.version,
        name: input.name,
        description: input.description,
        benefits: input.benefits,
        exclusions: input.exclusions,
        price_minor: input.price_minor,
        currency: "TZS",
        billing_period: input.billing_period,
        accepting_requests: input.accepting_requests,
      });
      setEditing(null);
      setNotice(
        "Package terms saved. Existing pending requests use their original revision and need fresh review if terms changed.",
      );
      await load();
    } catch (e) {
      setError(
        errorMessage(
          e,
          "Package was not saved. Refresh if another operator changed its terms.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function review(
    row: RequestRow,
    action: "approve" | "decline",
    note: string,
  ) {
    if (lock.current) return;
    if (
      !window.confirm(
        action === "approve"
          ? "Assign this package administratively? This does not collect money or mark an invoice as paid."
          : "Decline this package request?",
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.post("/families/subscription-requests/" + row.id + "/review", {
        base_version: row.version,
        action,
        note,
      });
      setNotice(
        action === "approve"
          ? "Package assigned and review recorded. Payment status is managed separately."
          : "Request declined and review recorded.",
      );
      await load();
    } catch (e) {
      setError(
        errorMessage(
          e,
          "Request changed or could not be reviewed. Refresh before retrying.",
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
        title={admin ? "Family services & packages" : "Family care panel"}
        lede={
          admin
            ? "Coordinate family membership, named care teams and accountable package enrollment."
            : "Your assigned families, their members and named care teams in one workspace."
        }
        action={
          <Button
            variant="quiet"
            disabled={loading || busy}
            onClick={() => {
              setSelected(null);
              setEditing(null);
              void load();
            }}
          >
            Refresh family services
          </Button>
        }
      />
      <p className="rounded-lg border border-line bg-white p-4 text-sm">
        Family links do not share medical records. Consent is still required for
        clinical care and referrals.
      </p>
      {admin && (
        <nav
          aria-label="Family services sections"
          className="flex flex-wrap gap-2"
        >
          {[
            ["families", "Family directory"],
            ["packages", "Subscription packages"],
            ["requests", "Enrollment requests"],
          ].map(([v, label]) => (
            <Button
              key={v}
              variant={tab === v ? "primary" : "quiet"}
              aria-pressed={tab === v}
              disabled={busy}
              onClick={() => {
                setTab(v);
                setNotice("");
              }}
            >
              {label}
            </Button>
          ))}
        </nav>
      )}
      {error && <Notice>{error}</Notice>}
      {notice && (
        <p role="status" className="rounded-lg border border-line p-4">
          {notice}
        </p>
      )}
      {tab === "families" && (
        <>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setSelected(null);
              setSearch(query.trim());
            }}
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="family-field-1">Search family name</label>
              <input
                id="family-field-1"
                className={inputClass}
                value={query}
                maxLength={100}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button disabled={busy || loading}>Search families</Button>
          </form>
          {!loading && !error && !rows.length && (
            <Empty>
              {admin
                ? "No families match this search. Families are created by the patient account holder."
                : "No families are currently assigned to your care panel."}
            </Empty>
          )}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              {rows.map((f) => (
                <Card key={f.id}>
                  <div className="flex flex-wrap justify-between gap-3">
                    <h2 className="text-lg font-semibold">{f.name}</h2>
                    <Badge>{tierName(f.subscription_tier)}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-ink-soft">
                    {f.members.length} linked members · GP:{" "}
                    {f.gp_clinician?.full_name ?? "Unassigned"}
                  </p>
                  <p className="text-sm text-ink-soft">
                    OB-GYN: {f.obgyn_clinician?.full_name ?? "Unassigned"}
                  </p>
                  <Button
                    className="mt-4"
                    variant="quiet"
                    aria-pressed={selected?.id === f.id}
                    onClick={() => setSelected(f)}
                  >
                    Open {f.name}
                  </Button>
                </Card>
              ))}
            </div>
            {selected && (
              <FamilyDetail
                key={selected.id + ":" + selected.version}
                family={selected}
                admin={admin}
                onSaved={(f) => {
                  setSelected(f);
                  setRows((old) =>
                    old.map((row) => (row.id === f.id ? f : row)),
                  );
                  setNotice("Family care team updated.");
                }}
              />
            )}
          </div>
        </>
      )}
      {tab === "packages" && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-xl font-semibold">Subscription packages</h2>
            <p className="text-sm text-ink-soft">
              TZS · Publish approved terms before opening requests
            </p>
          </div>
          <div className="grid items-start gap-5 xl:grid-cols-3">
            {plans.map((p) => (
              <Card key={p.tier}>
                <Badge tone={p.accepting_requests ? "good" : "neutral"}>
                  {p.accepting_requests ? "Requests open" : "Requests closed"}
                </Badge>
                <h3 className="mt-4 text-xl font-semibold">{p.name}</h3>
                <p className="mt-2 text-sm text-ink-soft">{p.description}</p>
                <p className="my-5 text-2xl font-semibold">
                  {money(p)}
                  <span className="block text-sm font-normal text-ink-soft">
                    {p.price_minor === null
                      ? "Confirm price with service operator"
                      : p.billing_period === "annual"
                        ? "per year"
                        : "per month"}
                  </span>
                </p>
                <h4 className="font-semibold">Included services</h4>
                {p.benefits.length ? (
                  <ul className="my-3 list-disc space-y-2 pl-5 text-sm">
                    {p.benefits.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="my-3 text-sm text-ink-soft">
                    Benefits have not been published.
                  </p>
                )}
                <h4 className="mt-5 font-semibold">Exclusions & conditions</h4>
                <ul className="my-3 list-disc space-y-2 pl-5 text-sm">
                  {p.exclusions.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                <p className="text-sm text-ink-soft">Revision {p.version}</p>
                <Button
                  className="mt-4"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setEditing(p)}
                >
                  Edit {p.name}
                </Button>
              </Card>
            ))}
          </div>
          <p className="text-sm text-ink-soft">
            Package assignment is an administrative record. Enrollment requests
            do not charge a payment method or confirm payment. Published
            benefits do not automatically change clinical access permissions.
          </p>
          {editing && (
            <PlanEditor
              key={editing.tier + editing.version}
              plan={editing}
              busy={busy}
              onSave={savePlan}
              onCancel={() => setEditing(null)}
            />
          )}
        </>
      )}
      {tab === "requests" && (
        <>
          <div className="block max-w-xs">
            <label htmlFor="family-field-2">Request status</label>
            <select
              id="family-field-2"
              className={inputClass}
              value={filter}
              disabled={busy}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="pending">Awaiting review</option>
              <option value="reviewed">Reviewed</option>
              <option value="all">All requests</option>
            </select>
          </div>
          {!loading && !error && !requests.length && (
            <Empty>No enrollment requests match this queue.</Empty>
          )}
          <div className="space-y-4">
            {requests.map((r) => (
              <RequestReview
                key={r.id + ":" + r.version}
                row={r}
                busy={busy}
                onReview={review}
              />
            ))}
          </div>
        </>
      )}
      {loading && <p role="status">Verifying family services…</p>}
      {cursor && !loading && (
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => void load(cursor)}
        >
          Load more
        </Button>
      )}
    </PageShell>
  );
}
function PlanEditor({
  plan,
  busy,
  onSave,
  onCancel,
}: {
  plan: Plan;
  busy: boolean;
  onSave: (p: Plan) => Promise<void>;
  onCancel: () => void;
}) {
  const [p, setP] = useState(plan),
    [price, setPrice] = useState(
      plan.price_minor === null ? "" : String(plan.price_minor / 100),
    ),
    [benefits, setBenefits] = useState(plan.benefits.join("\n")),
    [exclusions, setExclusions] = useState(plan.exclusions.join("\n")),
    [problem, setProblem] = useState("");
  const lines = (s: string) =>
    s
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  function submit(e: FormEvent) {
    e.preventDefault();
    const n = price.trim() === "" ? null : Number(price);
    if (
      n !== null &&
      (!Number.isFinite(n) ||
        n < 0 ||
        n > 20000000 ||
        Math.abs(n * 100 - Math.round(n * 100)) > 0.00001)
    ) {
      setProblem("Enter a valid TZS amount with at most two decimal places.");
      return;
    }
    if (p.accepting_requests && (n === null || !lines(benefits).length)) {
      setProblem(
        "Publish a price and included services before opening requests.",
      );
      return;
    }
    setProblem("");
    void onSave({
      ...p,
      price_minor: n === null ? null : Math.round(n * 100),
      benefits: lines(benefits),
      exclusions: lines(exclusions),
    });
  }
  return (
    <Card>
      <h2 className="text-xl font-semibold">Edit package: {plan.name}</h2>
      <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        {problem && (
          <div className="sm:col-span-2">
            <Notice>{problem}</Notice>
          </div>
        )}
        <div>
          <label htmlFor="family-field-3">Package name</label>
          <input
            id="family-field-3"
            required
            maxLength={100}
            className={inputClass}
            value={p.name}
            onChange={(e) => setP({ ...p, name: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="family-field-4">Price in TZS</label>
          <input
            id="family-field-4"
            inputMode="decimal"
            className={inputClass}
            placeholder="Not published"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="family-field-5">Package description</label>
          <textarea
            id="family-field-5"
            required
            maxLength={600}
            className={areaClass}
            value={p.description}
            onChange={(e) => setP({ ...p, description: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="family-field-6">
            Included services (one per line, up to 12)
          </label>
          <textarea
            id="family-field-6"
            rows={5}
            className={areaClass}
            value={benefits}
            onChange={(e) => setBenefits(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="family-field-7">
            Exclusions & conditions (one per line, up to 12)
          </label>
          <textarea
            id="family-field-7"
            rows={5}
            className={areaClass}
            value={exclusions}
            onChange={(e) => setExclusions(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="family-field-8">Billing period</label>
          <select
            id="family-field-8"
            className={inputClass}
            value={p.billing_period}
            onChange={(e) => setP({ ...p, billing_period: e.target.value })}
          >
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div className="flex min-h-11 items-center gap-3">
          <input
            id="family-field-9"
            type="checkbox"
            className="h-5 w-5"
            checked={p.accepting_requests}
            onChange={(e) =>
              setP({ ...p, accepting_requests: e.target.checked })
            }
          />
          <label htmlFor="family-field-9">Accept new requests</label>
        </div>
        <p className="text-sm text-ink-soft sm:col-span-2">
          Use approved service terms. Do not include patient information. Saving
          a revision invalidates approval of pending requests made against older
          terms.
        </p>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          <Button disabled={busy}>Save package terms</Button>
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel package edit
          </Button>
        </div>
      </form>
    </Card>
  );
}
function FamilyDetail({
  family: f,
  admin,
  onSaved,
}: {
  family: Family;
  admin: boolean;
  onSaved: (f: Family) => void;
}) {
  const [roster, setRoster] = useState<Clinician[]>([]),
    [name, setName] = useState(""),
    [gp, setGp] = useState(f.gp_clinician?.id ?? ""),
    [ob, setOb] = useState(f.obgyn_clinician?.id ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false);
  async function search() {
    setBusy(true);
    setError("");
    try {
      const r = await api.get<Page<Clinician>>("/families/clinicians", {
        params: { q: name, limit: 100 },
      });
      setRoster(r.data.data);
    } catch (e) {
      setRoster([]);
      setError(errorMessage(e, "Care-team roster could not be loaded."));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await api.post<Family>("/families/" + f.id + "/assignments", {
        base_version: f.version,
        gp_clinician_id: gp || null,
        obgyn_clinician_id: ob || null,
      });
      onSaved(r.data);
    } catch (e) {
      setError(
        errorMessage(
          e,
          "Care team could not be saved. Refresh the family and verify capacity.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const choices = (specialty: string, current: Family["gp_clinician"]) => (
    <>
      <option value="">Unassigned</option>
      {current && !roster.some((c) => c.id === current.id) && (
        <option value={current.id}>{current.full_name} (current)</option>
      )}
      {roster
        .filter((c) => c.specialty === specialty)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.full_name} · {c.family_load}/{c.max_family_load || "unlimited"}{" "}
            families
          </option>
        ))}
    </>
  );
  return (
    <Card>
      <h2 className="text-xl font-semibold">{f.name}</h2>
      <p className="mt-1 text-sm text-ink-soft">Family reference: {f.id}</p>
      <dl className="mt-5 grid gap-4">
        <div>
          <dt className="text-sm text-ink-soft">Assigned package</dt>
          <dd>{tierName(f.subscription_tier)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">Family GP</dt>
          <dd>
            {f.gp_clinician?.full_name ?? "Unassigned"}
            {f.gp_clinician &&
              !f.gp_clinician.available &&
              " · Access unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">OB-GYN</dt>
          <dd>
            {f.obgyn_clinician?.full_name ?? "Unassigned"}
            {f.obgyn_clinician &&
              !f.obgyn_clinician.available &&
              " · Access unavailable"}
          </dd>
        </div>
      </dl>
      <h3 className="mt-6 font-semibold">
        Linked family members ({f.members.length})
      </h3>
      {!f.members.length ? (
        <p className="mt-3 text-sm text-ink-soft">
          No profiles have been linked by the family head.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {f.members.map((m) => (
            <li
              className="flex flex-wrap justify-between gap-2 py-3"
              key={m.id}
            >
              <span>{m.full_name}</span>
              <span className="text-sm capitalize text-ink-soft">
                {m.relationship.replaceAll("_", " ")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {admin && (
        <form
          className="mt-6 space-y-4 border-t border-line pt-5"
          onSubmit={save}
        >
          <h3 className="font-semibold">Assign the care team</h3>
          {error && <Notice>{error}</Notice>}
          <div className="block">
            <label htmlFor="family-field-10">Find verified clinicians</label>
            <input
              id="family-field-10"
              className={inputClass}
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="quiet"
            disabled={busy}
            onClick={() => void search()}
          >
            Search clinician roster
          </Button>
          <p className="text-sm text-ink-soft">
            Showing up to 100 matches. Refine the name search to find a
            clinician. Capacity and specialty are checked when saving.
          </p>
          <div className="block">
            <label htmlFor="family-field-11">Family GP</label>
            <select
              id="family-field-11"
              className={inputClass}
              value={gp}
              disabled={busy}
              onChange={(e) => setGp(e.target.value)}
            >
              {choices("general_practice", f.gp_clinician)}
            </select>
          </div>
          <div className="block">
            <label htmlFor="family-field-12">OB-GYN</label>
            <select
              id="family-field-12"
              className={inputClass}
              value={ob}
              disabled={busy}
              onChange={(e) => setOb(e.target.value)}
            >
              {choices("obstetrics_gynaecology", f.obgyn_clinician)}
            </select>
          </div>
          <Button disabled={busy}>Save care team</Button>
        </form>
      )}
    </Card>
  );
}
function RequestReview({
  row: r,
  busy,
  onReview,
}: {
  row: RequestRow;
  busy: boolean;
  onReview: (
    r: RequestRow,
    a: "approve" | "decline",
    n: string,
  ) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <Card>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{r.family_name}</h3>
          <p className="text-sm text-ink-soft">
            {tierName(r.tier)} · Terms revision {r.plan_version} ·{" "}
            {dateTime(r.created_at)}
          </p>
        </div>
        <Badge>{r.status}</Badge>
      </div>
      {r.terms?.name && (
        <details className="mt-4 rounded-lg border border-line p-4">
          <summary className="cursor-pointer font-semibold">
            Terms reviewed by the applicant
          </summary>
          <p className="mt-3">
            {r.terms.name} · {money(r.terms)} / {r.terms.billing_period}
          </p>
          <p className="mt-2 text-sm">{r.terms.description}</p>
          <h4 className="mt-4 font-semibold">Included services</h4>
          <ul className="list-disc pl-5 text-sm">
            {r.terms.benefits.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <h4 className="mt-4 font-semibold">Exclusions & conditions</h4>
          <ul className="list-disc pl-5 text-sm">
            {r.terms.exclusions.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      )}
      {r.status === "pending" ? (
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onReview(r, "approve", note);
          }}
        >
          <div className="block">
            <label htmlFor={`family-request-note-${r.id}`}>
              Review note (no clinical details)
            </label>
            <textarea
              id={`family-request-note-${r.id}`}
              required
              minLength={5}
              maxLength={600}
              className={areaClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <p className="text-sm text-ink-soft">
            Confirm eligibility and service terms. Approval assigns the package;
            it does not confirm payment.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy || note.trim().length < 5}>
              Approve package allocation
            </Button>
            <Button
              type="button"
              variant="quiet"
              disabled={busy || note.trim().length < 5}
              onClick={() => void onReview(r, "decline", note)}
            >
              Decline request
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm">Review: {r.review_note}</p>
      )}
    </Card>
  );
}
