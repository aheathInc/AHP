"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, errorMessage } from "@/lib/api";
import {
  deskStatusLabels,
  deskVisitLabel,
  deskBlockers,
  elapsedArrival,
  type DeskVisit,
  type DeskFacility,
  type DeskDepartment,
} from "@/lib/frontDesk";
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
  inputClass,
} from "./ui";

export function FrontDeskWorkspace({
  mode,
}: {
  mode: "administration" | "clinical";
}) {
  const { data, status } = useSession();
  if (status !== "authenticated" || !data?.user?.id)
    return <p role="status">Verifying staff session…</p>;
  return (
    <FrontDeskContent key={`${data.user.id}:${data.user.role}`} mode={mode} />
  );
}

/** No clinical/financial action runs on mount. Every write requires an explicit operator action. */
function FrontDeskContent({ mode }: { mode: "administration" | "clinical" }) {
  const { data: session } = useSession();
  const identity = `${session?.user?.id ?? ""}:${session?.user?.role ?? ""}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const revision = useRef(0);
  const [facilities, setFacilities] = useState<DeskFacility[]>([]);
  const [facilityId, setFacilityId] = useState("");
  const [departments, setDepartments] = useState<DeskDepartment[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [visits, setVisits] = useState<DeskVisit[]>([]);
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [facilityCursor, setFacilityCursor] = useState<string | null>(null);
  const [worklist, setWorklist] = useState("active");
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const actionLock = useRef(false),
    directoryRevision = useRef(0);
  const busyRef = useRef(false),
    loadingRef = useRef(true),
    countRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  busyRef.current = busy;
  loadingRef.current = loading;
  countRef.current = visits.length;
  const selected = facilities.find((f) => f.id === facilityId);

  async function loadFacilities(next?: string) {
    const run = ++directoryRevision.current,
      actor = identityRef.current;
    try {
      const response = await api.get<{
        data: DeskFacility[];
        meta: { next_cursor: string | null };
      }>("/front-desk/facilities", { params: { limit: 100, cursor: next } });
      if (run !== directoryRevision.current || actor !== identityRef.current)
        return;
      setFacilities((previous) =>
        next ? [...previous, ...response.data.data] : response.data.data,
      );
      setFacilityCursor(response.data.meta.next_cursor);
      if (
        !next &&
        response.data.data.length === 1 &&
        !response.data.meta.next_cursor
      )
        setFacilityId(response.data.data[0].id);
    } catch (cause) {
      if (run === directoryRevision.current && actor === identityRef.current)
        setError(
          errorMessage(
            cause,
            "Facility directory could not be loaded. Retry the directory.",
          ),
        );
    } finally {
      if (run === directoryRevision.current && actor === identityRef.current)
        setLoading(false);
    }
  }
  useEffect(() => {
    identityRef.current = identity;
    void loadFacilities();
    return () => {
      revision.current++;
      directoryRevision.current++;
      identityRef.current = "";
    };
  }, [identity]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(
    async (next?: string) => {
      if (!facilityId) return;
      const run = ++revision.current,
        actor = identityRef.current;
      setLoading(true);
      setError(null);
      try {
        const [directory, response] = await Promise.all([
          api.get<{ data: DeskDepartment[] }>(
            `/front-desk/facilities/${facilityId}/departments`,
          ),
          api.get<{
            data: DeskVisit[];
            meta: {
              next_cursor: string | null;
              has_more: boolean;
              as_of?: string;
            };
          }>("/front-desk/staff/visits", {
            params: {
              facility_id: facilityId,
              department_id: departmentId || undefined,
              worklist,
              q: search || undefined,
              limit: 50,
              cursor: next,
            },
          }),
        ]);
        if (run !== revision.current || actor !== identityRef.current) return;
        setDepartments(directory.data.data);
        setVisits((previous) =>
          next
            ? Array.from(
                new Map(
                  [...previous, ...response.data.data].map((visit) => [
                    visit.id,
                    visit,
                  ]),
                ).values(),
              )
            : response.data.data,
        );
        setCursor(response.data.meta.next_cursor);
        setMore(response.data.meta.has_more);
        setChecked(response.data.meta.as_of ?? new Date().toISOString());
        if (!next)
          setSelectedId((current) =>
            response.data.data.some((visit) => visit.id === current)
              ? current
              : null,
          );
      } catch (cause) {
        if (run === revision.current && actor === identityRef.current) {
          setVisits([]);
          setCursor(null);
          setMore(false);
          setSelectedId(null);
          setError(
            errorMessage(
              cause,
              "Queue could not be confirmed. Refresh before taking action.",
            ),
          );
        }
      } finally {
        if (run === revision.current && actor === identityRef.current)
          setLoading(false);
      }
    },
    [facilityId, departmentId, worklist, search],
  );
  useEffect(() => {
    setVisits([]);
    setSelectedId(null);
    setChecked(null);
    setCursor(null);
    setMore(false);
    void load();
    return () => {
      revision.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!facilityId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (
          !stopped &&
          document.visibilityState === "visible" &&
          !busyRef.current &&
          !loadingRef.current &&
          countRef.current <= 50
        )
          await load();
        if (!stopped) schedule();
      }, 20000);
    };
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [facilityId, load]);

  async function act(
    visit: DeskVisit,
    action: string,
    body: Record<string, unknown> = {},
  ) {
    if (actionLock.current || loadingRef.current) return;
    actionLock.current = true;
    const actor = identityRef.current;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await api.post<DeskVisit>(
        `/front-desk/visits/${visit.id}/${action}`,
        { base_version: visit.version, ...body },
      );
      if (actor !== identityRef.current) return;
      setMessage(
        `${response.data.ticket}: ${deskStatusLabels[response.data.status]}.`,
      );
      await load();
    } catch (cause) {
      if (actor === identityRef.current)
        setError(
          errorMessage(
            cause,
            "Action was not confirmed. Refresh the queue before retrying.",
          ),
        );
    } finally {
      actionLock.current = false;
      if (actor === identityRef.current) setBusy(false);
    }
  }
  function selectVisit(id: string) {
    setSelectedId(id);
    requestAnimationFrame(() =>
      document
        .getElementById("desk-visit-detail")
        ?.scrollIntoView({ block: "start", behavior: "auto" }),
    );
  }
  const permits = (visit: DeskVisit, action: string) =>
    visit.permitted_actions?.includes(action) ?? false;
  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy || actionLock.current) return;
    actionLock.current = true;
    const actor = identityRef.current;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const input = {
        base_version: selected.version,
        enabled: form.get("enabled") === "on",
        payment_required: form.get("payment") === "on",
        insurance_required: form.get("insurance") === "on",
      };
      const response = await api.patch<{ version: number }>(
        `/front-desk/facilities/${selected.id}/policy`,
        input,
      );
      if (actor !== identityRef.current) return;
      setFacilities((all) =>
        all.map((f) =>
          f.id === selected.id
            ? { ...f, ...input, version: response.data.version }
            : f,
        ),
      );
      setMessage(
        "Facility policy saved. Existing visits retain their recorded requirements. Clinical review is always required.",
      );
    } catch (cause) {
      if (actor === identityRef.current)
        setError(errorMessage(cause, "Policy could not be saved."));
    } finally {
      actionLock.current = false;
      if (actor === identityRef.current) setBusy(false);
    }
  }
  async function aliases(event: FormEvent<HTMLFormElement>, d: DeskDepartment) {
    event.preventDefault();
    if (busy || actionLock.current) return;
    actionLock.current = true;
    const actor = identityRef.current;
    const input = String(new FormData(event.currentTarget).get("aliases") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        `/front-desk/facilities/${facilityId}/departments/${d.id}/navigation`,
        { base_version: d.version, aliases: input },
      );
      if (actor === identityRef.current) await load();
    } catch (cause) {
      if (actor === identityRef.current)
        setError(errorMessage(cause, "Navigation labels could not be saved."));
    } finally {
      actionLock.current = false;
      if (actor === identityRef.current) setBusy(false);
    }
  }
  return (
    <PageShell className="space-y-6">
      <PageHeader
        title={
          mode === "administration"
            ? "Digital front desk"
            : "Hospital intake queue"
        }
        lede="AHP-registered visits only. Find a patient, complete required reviews and move an arrived visit into the correct clinician’s care."
        action={
          <Button
            variant="quiet"
            disabled={!facilityId || loading || busy}
            onClick={() => void load()}
          >
            Refresh queue
          </Button>
        }
      />
      <p className="text-sm text-ink-soft">
        Queue position is not clinical priority. A patient who needs urgent
        assistance must be seen through the hospital’s urgent-care process.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Facility" htmlFor="desk-facility">
          <select
            id="desk-facility"
            className={inputClass}
            value={facilityId}
            disabled={busy}
            onChange={(event) => {
              ++revision.current;
              setVisits([]);
              setDepartments([]);
              setDepartmentId("");
              setMessage(null);
              setFacilityId(event.target.value);
              if (!event.target.value) setLoading(false);
            }}
          >
            <option value="">Choose facility</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {!f.enabled ? " — desk disabled" : ""}
              </option>
            ))}
          </select>
          {facilityCursor && (
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() => void loadFacilities(facilityCursor)}
            >
              Load more facilities
            </Button>
          )}
        </Field>
        <Field label="Department" htmlFor="desk-department">
          <select
            id="desk-department"
            className={inputClass}
            value={departmentId}
            disabled={!facilityId || busy}
            onChange={(event) => {
              ++revision.current;
              setVisits([]);
              setDepartmentId(event.target.value);
            }}
          >
            <option value="">
              {mode === "clinical"
                ? "My authorized department"
                : "All departments"}
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <section className="space-y-4" aria-label="Intake worklist filters">
        <div className="flex flex-wrap gap-2">
          {[
            ["active", "All active"],
            ["review", "Awaiting review"],
            ["waiting", "Ready for clinician"],
            ["called", "Called"],
            ["in_consultation", "In consultation"],
            ["escalated", "Immediate review"],
            ["completed", "Completed"],
            ["cancelled", "Cancelled"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={worklist === value}
              disabled={busy || !facilityId}
              className={`min-h-11 rounded-lg border px-3 py-2 text-sm ${worklist === value ? "border-petrol bg-petrol text-white" : "border-line bg-white"}`}
              onClick={() => {
                revision.current++;
                setVisits([]);
                setWorklist(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            revision.current++;
            setSearch(query.trim());
            if (search === query.trim()) void load();
          }}
        >
          <div className="min-w-0 flex-1">
            <label
              htmlFor="desk-search"
              className="mb-2 block text-sm font-medium"
            >
              Find patient or ticket
            </label>
            <input
              id="desk-search"
              className={inputClass}
              type="search"
              maxLength={100}
              value={query}
              disabled={busy || !facilityId}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Patient name, AHP ticket or visit ID"
            />
          </div>
          <Button disabled={busy || loading || !facilityId}>
            Search queue
          </Button>
        </form>
        <p className="text-sm text-ink-soft" aria-live="polite">
          {loading
            ? "Refreshing queue…"
            : `${visits.length} loaded visits${checked ? ` · checked ${dateTime(checked)}` : ""}.`}{" "}
          {visits.length > 50
            ? "Automatic refresh is paused after loading more. Refresh queue returns to the first page."
            : "Refreshes every 20 seconds while this page is visible."}{" "}
          Elapsed time is time since declared arrival, not an estimated waiting
          time.
        </p>
      </section>
      {error && <Notice>{error}</Notice>}
      {message && (
        <p
          role="status"
          className="rounded-lg border border-line p-3 text-petrol"
        >
          {message}
        </p>
      )}
      {mode === "administration" && selected && (
        <Card>
          <details>
            <summary className="cursor-pointer font-semibold">
              Facility policy & directory labels
            </summary>
            <form
              key={`${selected.id}:${selected.version}`}
              onSubmit={configure}
              className="mt-4 space-y-3"
            >
              <p className="text-sm text-ink-soft">
                Enable only after the facility agrees to operate this queue.
                This does not establish a hospital integration or waive clinical
                triage.
              </p>
              <label className="block">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={selected.enabled}
                />{" "}
                Enable AHP digital front desk
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  name="payment"
                  defaultChecked={selected.payment_required}
                />{" "}
                Require manual payment-clearance confirmation
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  name="insurance"
                  defaultChecked={selected.insurance_required}
                />{" "}
                Require manual insurance-clearance confirmation
              </label>
              <Button disabled={busy}>Save facility policy</Button>
            </form>
            {departments.map((d) => (
              <form
                key={`${d.id}:${d.version}`}
                onSubmit={(e) => void aliases(e, d)}
                className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"
              >
                <div className="grow">
                  <Field
                    label={`${d.name}: directory terms (comma separated)`}
                    htmlFor={`aliases-${d.id}`}
                    hint="Navigation keywords only. Not diagnosis or urgency rules."
                  >
                    <input
                      id={`aliases-${d.id}`}
                      name="aliases"
                      className={inputClass}
                      defaultValue={d.navigation_aliases?.join(", ") ?? ""}
                      maxLength={1800}
                    />
                  </Field>
                </div>
                <Button variant="quiet" disabled={busy}>
                  Save labels
                </Button>
              </form>
            ))}
          </details>
        </Card>
      )}
      {loading && !visits.length ? (
        <p role="status">Loading verified queue…</p>
      ) : !loading && !error && visits.length === 0 ? (
        <Empty>
          {facilityId
            ? "No active visits in this authorized queue."
            : "Select a facility to open its queue."}
        </Empty>
      ) : null}
      {!error && visits.length > 0 && (
        <section
          aria-label="Hospital intake worklist"
          className="rounded-xl border border-line bg-white"
        >
          <ul className="divide-y divide-line sm:hidden">
            {visits.map((visit) => (
              <li key={visit.id}>
                <button
                  type="button"
                  className="w-full space-y-2 p-4 text-left"
                  disabled={busy || loading}
                  onClick={() => selectVisit(visit.id)}
                >
                  <span className="block break-words font-semibold">
                    {visit.ticket} · {visit.patient_name}
                  </span>
                  <span className="block text-sm">{deskVisitLabel(visit)}</span>
                  <span className="block text-sm text-ink-soft">
                    {visit.department.name} ·{" "}
                    {elapsedArrival(visit.checked_in_at)}
                  </span>
                  <span className="block text-sm">
                    {deskBlockers(visit).join(" · ") || "Open visit details"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div
            className="hidden overflow-x-auto sm:block"
            tabIndex={0}
            role="region"
            aria-label="Intake queue table"
          >
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-paper-sunk">
                  <th className="p-4">Patient / ticket</th>
                  <th className="p-4">Department / clinician</th>
                  <th className="p-4">Stage</th>
                  <th className="p-4">Arrival / requirements</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((visit) => (
                  <tr key={visit.id} className="border-b border-line">
                    <th scope="row" className="p-4 text-left font-normal">
                      <p className="font-semibold">{visit.patient_name}</p>
                      <p className="mt-1 text-xs text-ink-soft">
                        {visit.ticket}
                      </p>
                    </th>
                    <td className="p-4">
                      {visit.department.name}
                      <p className="mt-1 text-xs text-ink-soft">
                        {visit.assigned_clinician?.name ??
                          visit.requested_clinician?.name ??
                          "Department pool"}
                      </p>
                    </td>
                    <td className="p-4">
                      <Badge
                        tone={
                          visit.clearance.clinical_review === "escalated"
                            ? "problem"
                            : visit.status === "waiting"
                              ? "good"
                              : "neutral"
                        }
                      >
                        {deskVisitLabel(visit)}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <p>{elapsedArrival(visit.checked_in_at)}</p>
                      <p className="mt-1 text-xs text-ink-soft">
                        {deskBlockers(visit).join(" · ") ||
                          (visit.status === "waiting"
                            ? "Required reviews recorded"
                            : deskStatusLabels[visit.status])}
                      </p>
                    </td>
                    <td className="p-4">
                      <Button
                        variant="quiet"
                        disabled={busy || loading}
                        onClick={() => selectVisit(visit.id)}
                      >
                        Open visit
                        <span className="sr-only"> {visit.ticket}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!error &&
        visits
          .filter((visit) => visit.id === selectedId)
          .map((visit) => (
            <section
              key={visit.id}
              id="desk-visit-detail"
              className="scroll-mt-24"
              tabIndex={-1}
              aria-label="Selected visit details"
            >
              <Card className="space-y-4">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">
                      {visit.ticket} · {visit.patient_name}
                    </h2>
                    <p className="text-sm text-ink-soft">
                      {visit.department.name} ·{" "}
                      {visit.requested_clinician?.name ?? "Department pool"}
                    </p>
                  </div>
                  <Badge>{deskVisitLabel(visit)}</Badge>
                </div>
                {visit.purpose && (
                  <p className="max-w-prose whitespace-pre-wrap">
                    {visit.purpose}
                  </p>
                )}
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-ink-soft">Arrival</dt>
                    <dd>
                      {visit.checked_in_at
                        ? dateTime(visit.checked_in_at)
                        : "Not declared"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Clinical review</dt>
                    <dd>{visit.clearance.clinical_review}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Payment review</dt>
                    <dd>{visit.clearance.payment.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-soft">Insurance review</dt>
                    <dd>{visit.clearance.insurance.replaceAll("_", " ")}</dd>
                  </div>
                </dl>
                {mode === "clinical" &&
                  visit.status === "called" &&
                  !permits(visit, "start") && (
                    <Notice>
                      This patient was called by{" "}
                      {visit.assigned_clinician?.name ?? "another clinician"}.
                      Only that clinician can start the consultation.
                    </Notice>
                  )}
                {mode === "clinical" &&
                  visit.status === "waiting" &&
                  !permits(visit, "call") && (
                    <p className="text-sm text-ink-soft">
                      Calling requires the requested clinician or an eligible
                      department clinician with current availability and no
                      other called/in-care intake visit.
                    </p>
                  )}
                {visit.clearance.clinical_review === "escalated" && (
                  <Notice>
                    Clinician marked this visit for immediate review. Do not
                    admit to the routine queue without a new clinical
                    assessment.
                  </Notice>
                )}
                {mode === "administration" &&
                  ["preregistered", "awaiting_review"].includes(
                    visit.status,
                  ) && (
                    <AdministrativeForm
                      visit={visit}
                      busy={busy || loading}
                      submit={(body) =>
                        act(visit, "administrative-review", body)
                      }
                    />
                  )}
                {mode === "clinical" && (
                  <div className="flex flex-wrap gap-3">
                    {permits(visit, "clinical-review") && (
                      <>
                        <Button
                          disabled={busy || loading}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Confirm you have assessed this patient and cleared them for the routine department queue.",
                              )
                            )
                              void act(visit, "clinical-review", {
                                decision: "cleared",
                              });
                          }}
                        >
                          Record routine-queue clearance
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busy || loading}
                          onClick={() => {
                            if (
                              window.confirm(
                                "Record that immediate clinician review is required? This does not dispatch emergency help.",
                              )
                            )
                              void act(visit, "clinical-review", {
                                decision: "escalated",
                              });
                          }}
                        >
                          Needs immediate review
                        </Button>
                      </>
                    )}
                    {visit.status === "waiting" && (
                      <Button
                        disabled={busy || loading || !permits(visit, "call")}
                        onClick={() => void act(visit, "call")}
                      >
                        Call patient
                      </Button>
                    )}
                    {visit.status === "called" && permits(visit, "start") && (
                      <Button
                        disabled={busy || loading}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Start this patient’s consultation now?",
                            )
                          )
                            void act(visit, "start");
                        }}
                      >
                        Start consultation
                      </Button>
                    )}
                    {visit.consultation_id && (
                      <Link
                        className="inline-flex min-h-11 items-center text-petrol underline"
                        href={`/doctor/case/${visit.consultation_id}`}
                      >
                        Open consultation & chat
                      </Link>
                    )}
                  </div>
                )}
                {permits(visit, "cancel") && (
                  <Button
                    variant="quiet"
                    disabled={busy || loading}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Cancel this visit? No consultation or clinical history will be deleted.",
                        )
                      )
                        void act(visit, "cancel");
                    }}
                  >
                    Cancel visit
                  </Button>
                )}
              </Card>
            </section>
          ))}
      {more && cursor && (
        <Button
          variant="quiet"
          disabled={loading || busy}
          onClick={() => void load(cursor)}
        >
          Load more visits
        </Button>
      )}
      {!facilityId && !loading && (
        <Button variant="quiet" onClick={() => void loadFacilities()}>
          Refresh facility directory
        </Button>
      )}
    </PageShell>
  );
}

function AdministrativeForm({
  visit,
  busy,
  submit,
}: {
  visit: DeskVisit;
  busy: boolean;
  submit: (body: Record<string, unknown>) => Promise<void>;
}) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void submit({
      registration_confirmed: true,
      payment_check: visit.requirements.payment
        ? "manually_verified"
        : "not_required",
      insurance_check: visit.requirements.insurance
        ? "manually_verified"
        : "not_required",
      ...(visit.requirements.payment
        ? {
            payment_reference: String(
              values.get("payment_reference") ?? "",
            ).trim(),
          }
        : {}),
      ...(visit.requirements.insurance
        ? {
            insurance_reference: String(
              values.get("insurance_reference") ?? "",
            ).trim(),
          }
        : {}),
    });
  }
  return (
    <form
      onSubmit={save}
      className="max-w-2xl space-y-3 rounded-lg border border-line p-4"
    >
      <h3 className="font-semibold">Manual administrative clearance</h3>
      <p className="text-sm text-ink-soft">
        Record checks already performed by the facility. This does not charge
        money or verify insurance electronically. Use a non-sensitive internal
        reference, never a bank/card/member number.
      </p>
      {visit.requirements.payment && (
        <Field
          label="Payment verification reference"
          htmlFor={`payment-${visit.id}`}
        >
          <input
            id={`payment-${visit.id}`}
            name="payment_reference"
            className={inputClass}
            required
            maxLength={120}
          />
        </Field>
      )}
      {visit.requirements.insurance && (
        <Field
          label="Insurance verification reference"
          htmlFor={`insurance-${visit.id}`}
        >
          <input
            id={`insurance-${visit.id}`}
            name="insurance_reference"
            className={inputClass}
            required
            maxLength={120}
          />
        </Field>
      )}
      <label className="flex items-start gap-2">
        <input type="checkbox" required /> I have checked patient registration
        and the required administrative clearances.
      </label>
      <Button disabled={busy}>Record manual clearance</Button>
    </form>
  );
}
