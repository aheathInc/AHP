"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  api,
  errorMessage,
  idem,
  type EmergencyRequest,
  type Facility,
  type TransportUnit,
} from "@/lib/api";
import { Button, Field, Notice, inputClass } from "./ui";
import { STATUS_LABEL, canDispatch, nextStatuses } from "@/lib/emergency";
import { dateTime } from "@/lib/format";
const OUTCOMES = [
  ["transported", "Transported to facility"],
  ["treated_on_scene", "Treated at scene"],
  ["refused_care", "Refused care"],
  ["false_alarm", "False alarm"],
  ["deceased", "Deceased"],
];
export function DispatchPanel({
  emergency: initial,
  units: initialUnits,
  facilities: initialFacilities,
  facilityCursor: initialFacilityCursor,
}: {
  emergency: EmergencyRequest;
  units: TransportUnit[];
  facilities: Facility[];
  facilityCursor?: string;
}) {
  const { data: session, status: sessionStatus } = useSession();
  const [facilities, setFacilities] = useState(initialFacilities);
  const [facilityCursor, setFacilityCursor] = useState(initialFacilityCursor);
  const [loadingFacilities, setLoadingFacilities] = useState(false);
  const [emergency, setEmergency] = useState(initial),
    [units, setUnits] = useState(initialUnits);
  const [unitId, setUnitId] = useState(""),
    [facilityId, setFacilityId] = useState(""),
    [status, setStatus] = useState(""),
    [priority, setPriority] = useState(""),
    [outcome, setOutcome] = useState(""),
    [notes, setNotes] = useState(""),
    [reason, setReason] = useState("");
  const [priorityNote, setPriorityNote] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [checked, setChecked] = useState<string | null>(null);
  const scope = useRef(0),
    working = useRef(false),
    version = useRef(initial.version);
  const allowed = nextStatuses(emergency.status),
    dispatchable = canDispatch(emergency.status);
  function reset(row: EmergencyRequest) {
    setUnitId("");
    setFacilityId("");
    setStatus("");
    setPriority(
      row.priority === "highest" || row.priority === "other"
        ? row.priority
        : "",
    );
    setPriorityNote("");
    setOutcome("");
    setNotes("");
    setReason("");
  }
  async function refresh(generation: number) {
    const response = await api.get<EmergencyRequest>(
      `/emergency-requests/${initial.id}`,
    );
    const fleet = canDispatch(response.data.status)
      ? await api.get<{ data: TransportUnit[] }>("/transport-units", {
          params: {
            status: "available",
            near_lat: response.data.location.lat,
            near_lng: response.data.location.lng,
          },
        })
      : null;
    if (scope.current !== generation) return;
    if (response.data.version < version.current) return;
    if (version.current !== response.data.version) {
      reset(response.data);
      version.current = response.data.version;
    }
    setEmergency(response.data);
    if (fleet) setUnits(fleet.data.data);
    setChecked(response.data.as_of ?? new Date().toISOString());
  }
  useEffect(() => {
    const generation = ++scope.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    reset(initial);
    setBusy(false);
    working.current = false;
    async function tick() {
      if (cancelled) return;
      if (
        !document.hidden &&
        !working.current &&
        sessionStatus === "authenticated"
      ) {
        try {
          await refresh(generation);
          if (!cancelled) setError(null);
        } catch {
          if (!cancelled)
            setError(
              "Status refresh failed. Data may be stale; refresh before an operational action.",
            );
        }
      }
      if (!cancelled) timer = setTimeout(tick, 5000);
    }
    void tick();
    return () => {
      cancelled = true;
      scope.current++;
      clearTimeout(timer);
    };
  }, [initial.id, session?.user?.id, sessionStatus]);
  async function moreFacilities() {
    if (!facilityCursor || loadingFacilities) return;
    const generation = scope.current;
    setLoadingFacilities(true);
    try {
      const response = await api.get<{
        data: Facility[];
        meta?: { next_cursor?: string | null };
      }>("/facilities", { params: { limit: 50, cursor: facilityCursor } });
      if (scope.current !== generation) return;
      setFacilities((rows) =>
        Array.from(
          new Map(
            [...rows, ...response.data.data].map((row) => [row.id, row]),
          ).values(),
        ),
      );
      setFacilityCursor(response.data.meta?.next_cursor ?? undefined);
    } catch {
      if (scope.current === generation)
        setError(
          "Could not load more facilities. Retry or use the operational channel.",
        );
    } finally {
      if (scope.current === generation) setLoadingFacilities(false);
    }
  }
  async function action(kind: "dispatch" | "status" | "release" | "priority") {
    if (working.current || sessionStatus !== "authenticated") return;
    let body: Record<string, unknown>, path: string;
    if (kind === "dispatch") {
      if (!units.some((unit) => unit.id === unitId) || !facilityId || !priority)
        return;
      if (
        !window.confirm(
          `Assign ${units.find((unit) => unit.id === unitId)?.call_sign} to this incident and ${facilities.find((facility) => facility.id === facilityId)?.name}? Response priority: ${priority}. This records an assignment; confirm crew instructions through your operational channel.`,
        )
      )
        return;
      body = {
        transport_unit_id: unitId,
        destination_facility_id: facilityId,
        priority,
        base_version: emergency.version,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(reason.trim() ? { break_glass_reason: reason.trim() } : {}),
      };
      path = `/emergency-requests/${emergency.id}/dispatch`;
    } else if (kind === "priority") {
      if (!priority || priorityNote.trim().length < 10) return;
      body = {
        priority,
        base_version: emergency.version,
        notes: priorityNote.trim(),
      };
      path = `/emergency-requests/${emergency.id}/priority`;
    } else if (kind === "status") {
      if (!status) return;
      if (
        ["resolved", "cancelled"].includes(status) &&
        !window.confirm(
          `Record ${STATUS_LABEL[status as EmergencyRequest["status"]]}${outcome ? ` with outcome ${outcome}` : ""}? Confirm the actual outcome with the response team first.`,
        )
      )
        return;
      body = {
        status,
        base_version: emergency.version,
        ...(status === "triaged" ? { priority } : {}),
        ...(status === "resolved" ? { outcome } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      path = `/emergency-requests/${emergency.id}/status`;
    } else {
      if (
        !emergency.response_unit ||
        !window.confirm(
          "Have you confirmed with the crew that this unit is ready for another incident?",
        )
      )
        return;
      body = {
        status: "available",
        base_version: emergency.response_unit.version,
      };
      path = `/transport-units/${emergency.response_unit.id}/status`;
    }
    working.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const generation = scope.current;
    try {
      await api.post(path, body, idem());
      if (scope.current !== generation) return;
      await refresh(generation);
      if (scope.current === generation)
        setNotice(
          "The server recorded the action. Confirm field operations through the crew’s communication channel.",
        );
    } catch (e) {
      if (scope.current === generation) {
        setError(
          errorMessage(
            e,
            "Action is unconfirmed. Refresh the incident before retrying.",
          ),
        );
        try {
          await refresh(generation);
        } catch {}
      }
    } finally {
      working.current = false;
      if (scope.current === generation) setBusy(false);
    }
  }
  const terminal = ["resolved", "cancelled"].includes(emergency.status);
  return (
    <div className="mt-8 space-y-6">
      {error && (
        <div role="alert">
          <Notice>{error}</Notice>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <section aria-label="Current emergency status" className="space-y-2">
        <h2 className="text-xl font-semibold">
          {STATUS_LABEL[emergency.status]}
        </h2>
        <p>
          {emergency.acknowledged_at
            ? `Dispatcher acknowledged ${dateTime(emergency.acknowledged_at)}`
            : "Awaiting dispatcher acknowledgement"}
        </p>
        <p className="text-sm text-ink-soft">
          {checked
            ? `Last checked ${dateTime(checked)}`
            : "Waiting for a fresh server read"}{" "}
          · Revision {emergency.version}
        </p>
        {emergency.reporter_phone && (
          <p>
            Callback:{" "}
            <a className="underline" href={`tel:${emergency.reporter_phone}`}>
              {emergency.reporter_phone}
            </a>
          </p>
        )}
        {emergency.landmark && <p>Landmark: {emergency.landmark}</p>}
        <p className="text-sm">
          Location source: {emergency.location_source ?? "manual"}
          {emergency.location_accuracy_m != null
            ? ` · approximate accuracy ${Math.round(emergency.location_accuracy_m)} m`
            : ""}
          {emergency.location_captured_at
            ? ` · captured ${dateTime(emergency.location_captured_at)}`
            : ""}
        </p>
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded border border-line px-4"
          onClick={() =>
            void refresh(scope.current).catch(() =>
              setError(
                "Refresh failed. Check the operational communication channel.",
              ),
            )
          }
        >
          Refresh incident
        </button>
      </section>
      {!terminal && (
        <Field
          label="Assessed response priority"
          htmlFor="emergency-priority"
          hint="Set by trained dispatch staff using the approved local protocol. No automatic clinical classification is applied."
        >
          <select
            id="emergency-priority"
            value={priority}
            disabled={busy}
            onChange={(e) => setPriority(e.target.value)}
            className={inputClass}
          >
            <option value="">Assess and select…</option>
            <option value="highest">Highest response priority</option>
            <option value="other">Other assessed response priority</option>
          </select>
        </Field>
      )}
      {!terminal && emergency.status !== "reported" && (
        <section className="space-y-3">
          <Field
            label="Reason for priority reassessment"
            htmlFor="priority-note"
          >
            <textarea
              id="priority-note"
              value={priorityNote}
              minLength={10}
              maxLength={1000}
              onChange={(e) => setPriorityNote(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Button
            type="button"
            variant="quiet"
            disabled={
              busy ||
              !priority ||
              priority === emergency.priority ||
              priorityNote.trim().length < 10
            }
            onClick={() => void action("priority")}
          >
            Record priority reassessment
          </Button>
        </section>
      )}
      {dispatchable && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Assign transport and destination
          </h2>
          {!units.length && (
            <Notice>
              No available unit was returned. Use the operational escalation
              channel and refresh fleet availability.
            </Notice>
          )}
          <Field label="Available unit" htmlFor="emergency-unit">
            <select
              id="emergency-unit"
              value={unitId}
              disabled={busy}
              onChange={(e) => setUnitId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a unit…</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.call_sign} · {u.capability} ·{" "}
                  {u.distance_km != null && !u.location_is_stale
                    ? `${u.distance_km.toFixed(1)} km straight-line`
                    : "location unconfirmed"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Receiving facility" htmlFor="emergency-facility">
            <select
              id="emergency-facility"
              value={facilityId}
              disabled={busy}
              onChange={(e) => setFacilityId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select an active facility…</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
          {facilityCursor && (
            <button
              type="button"
              disabled={busy || loadingFacilities}
              onClick={() => void moreFacilities()}
              className="min-h-11 rounded border border-line px-4"
            >
              {loadingFacilities
                ? "Loading facilities…"
                : "Load more receiving facilities"}
            </button>
          )}
          <p className="text-sm text-ink-soft">
            Facility selection does not confirm capacity or acceptance. Confirm
            the destination and crew instructions through your operational
            channel.
          </p>
          {emergency.patient_profile_id && (
            <details>
              <summary className="cursor-pointer py-3">
                Emergency minimum context access
              </summary>
              <Field
                label="Break-glass justification, only if necessary"
                htmlFor="emergency-context-reason"
                hint="Without existing consent or an explicit justification, dispatch proceeds without patient-context access. No hospital data transfer is asserted."
              >
                <textarea
                  id="emergency-context-reason"
                  value={reason}
                  minLength={10}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </details>
          )}
          <Button
            type="button"
            disabled={
              busy ||
              !priority ||
              !unitId ||
              !facilityId ||
              (reason.trim().length > 0 && reason.trim().length < 10)
            }
            onClick={() => void action("dispatch")}
          >
            {busy ? "Recording…" : "Review and assign unit"}
          </Button>
        </section>
      )}
      {allowed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Record a verified update</h2>
          <Field label="New status" htmlFor="emergency-status">
            <select
              id="emergency-status"
              value={status}
              disabled={busy}
              onChange={(e) => setStatus(e.target.value)}
              className={inputClass}
            >
              <option value="">Select confirmed status…</option>
              {allowed.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          {status === "resolved" && (
            <Field label="Confirmed outcome" htmlFor="emergency-outcome">
              <select
                id="emergency-outcome"
                value={outcome}
                disabled={busy}
                onChange={(e) => setOutcome(e.target.value)}
                className={inputClass}
              >
                <option value="">Select the actual outcome…</option>
                {OUTCOMES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label="Operational note / handover summary"
            htmlFor="emergency-note"
          >
            <textarea
              id="emergency-note"
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Button
            type="button"
            disabled={
              busy ||
              !status ||
              (status === "triaged" && !priority) ||
              (status === "resolved" && !outcome)
            }
            onClick={() => void action("status")}
          >
            {busy
              ? "Recording…"
              : status === "triaged"
                ? "Acknowledge and record assessment"
                : "Record status update"}
          </Button>
        </section>
      )}
      {terminal &&
        emergency.response_unit &&
        emergency.response_unit.status !== "available" && (
          <section className="space-y-3">
            <h2 className="font-semibold">Crew availability confirmation</h2>
            <p>
              Closing an incident does not automatically make its unit
              available.
            </p>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => void action("release")}
            >
              Confirm crew ready and release unit
            </Button>
          </section>
        )}
      {!!emergency.timeline?.length && (
        <section>
          <h2 className="text-lg font-semibold">Recorded timeline</h2>
          <ol className="mt-3 space-y-2">
            {emergency.timeline.map((event, index) => (
              <li key={`${event.occurred_at}:${index}`}>
                {event.kind==="priority_assessment"?"Priority reassessment":STATUS_LABEL[event.status]} · {dateTime(event.occurred_at)}
                {event.notes && (
                  <p className="mt-1 text-sm text-ink-soft">{event.notes}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
