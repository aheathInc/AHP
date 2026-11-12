"use client";
import { useRef, useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { api, errorMessage, idem, type InvestigationOrder } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { Badge, Button, Field, Notice, areaClass, inputClass } from "./ui";
import { DiagnosticReport, diagnosticStatus } from "./DiagnosticReport";
type Row = {
  analyte: string;
  value: string;
  unit: string;
  reference_low: string;
  reference_high: string;
  critical_low: string;
  critical_high: string;
};
const blank = (): Row => ({
  analyte: "",
  value: "",
  unit: "",
  reference_low: "",
  reference_high: "",
  critical_low: "",
  critical_high: "",
});
const bounds = [
  "reference_low",
  "reference_high",
  "critical_low",
  "critical_high",
] as const;
const labels = {
  reference_low: "Reference low",
  reference_high: "Reference high",
  critical_low: "Critical low",
  critical_high: "Critical high",
};
export function LabOrderWorkspace({
  initialOrder,
  ownerId,
}: {
  initialOrder: InvestigationOrder;
  ownerId?: string;
}) {
  const { data: session, status } = useSession();
  if (
    status !== "authenticated" ||
    !session?.user ||
    session.user.role !== "lab_technician" ||
    (ownerId && ownerId !== session.user.id)
  )
    return (
      <Notice>
        Sign in with the assigned laboratory account to access this order.
      </Notice>
    );
  return (
    <OrderWorkspace
      key={session.user.id + initialOrder.id}
      initialOrder={initialOrder}
    />
  );
}
function OrderWorkspace({
  initialOrder,
}: {
  initialOrder: InvestigationOrder;
}) {
  const [order, setOrder] = useState(initialOrder),
    [rows, setRows] = useState<Row[]>([blank()]),
    [narrative, setNarrative] = useState("");
  const [specimen, setSpecimen] = useState(""),
    [sampleType, setSampleType] = useState(""),
    [collected, setCollected] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [saved, setSaved] = useState<string | null>(null);
  const lock = useRef(false),
    attempt = useRef<{
      fingerprint: string;
      options: ReturnType<typeof idem>;
    }>();
  async function act(action: string, body: object) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setSaved(null);
    const fingerprint = action + JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, options: idem() };
    try {
      const response = await api.post<InvestigationOrder>(
        `/investigation-orders/${order.id}/${action}`,
        body,
        attempt.current.options,
      );
      setOrder(response.data);
      setReviewed(false);
      setEditing(false);
      setSaved(
        action === "collect"
          ? "Specimen receipt recorded."
          : action === "release"
            ? "Final report released to the ordering clinician and patient."
            : "Preliminary report saved. Review every result before release.",
      );
    } catch (cause) {
      setError(
        errorMessage(
          cause,
          "The update could not be confirmed. Retry the same submission or reload the order.",
        ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      setOrder(
        (await api.get<InvestigationOrder>(`/investigation-orders/${order.id}`))
          .data,
      );
      setReviewed(false);
    } catch (cause) {
      setError(errorMessage(cause, "Could not reload this order. Try again."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function change(index: number, key: keyof Row, value: string) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  }
  function prepare(event: FormEvent) {
    event.preventDefault();
    const values = rows.map((row) => ({
      analyte: row.analyte.trim(),
      value: row.value.trim(),
      unit: row.unit.trim() || undefined,
      ...Object.fromEntries(
        bounds
          .filter((key) => row[key].trim() !== "")
          .map((key) => [key, Number(row[key])]),
      ),
    }));
    if (
      values.some(
        (row) =>
          !row.analyte ||
          !row.value ||
          bounds.some(
            (key) =>
              key in row &&
              !Number.isFinite((row as Record<string, unknown>)[key]),
          ),
      )
    ) {
      setError(
        "Enter each test and result, with finite numeric bounds where supplied.",
      );
      return;
    }
    if (
      rows.some(
        (row) =>
          (row.reference_low !== "" &&
            row.reference_high !== "" &&
            Number(row.reference_low) > Number(row.reference_high)) ||
          (row.critical_low !== "" &&
            row.critical_high !== "" &&
            Number(row.critical_low) > Number(row.critical_high)),
      )
    ) {
      setError("A lower bound must not exceed its upper bound.");
      return;
    }
    void act("results", {
      base_version: order.version,
      save_as_draft: true,
      values,
      narrative: narrative.trim() || undefined,
    });
  }
  return (
    <div className="mt-6 space-y-6">
      <header className="border-b border-line pb-5">
        <div className="flex flex-wrap justify-between gap-3">
          <h1 className="text-2xl font-semibold">{order.investigation_code}</h1>
          <Badge tone={order.is_critical ? "problem" : "neutral"}>
            {diagnosticStatus(order)}
          </Badge>
        </div>
        <p className="mt-2">
          {order.patient_name} · {order.facility_name}
        </p>
        <p className="mt-1 break-words text-sm text-ink-soft">
          Patient reference: {order.patient_profile_id}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Ordered {dateTime(order.ordered_at)} · {order.urgency} · Revision{" "}
          {order.version}
        </p>
      </header>
      {order.clinical_notes && (
        <section>
          <h2 className="font-semibold">Requesting clinician’s notes</h2>
          <p className="mt-2 whitespace-pre-wrap">{order.clinical_notes}</p>
        </section>
      )}
      {error && <Notice>{error}</Notice>}
      {saved && (
        <p role="status" className="rounded-lg bg-paper-sunk p-4">
          {saved}
        </p>
      )}
      <Button disabled={busy} variant="quiet" onClick={() => void reload()}>
        Refresh order
      </Button>
      {["ordered", "scheduled"].includes(order.status) && (
        <form
          className="space-y-4 rounded-xl border border-line p-5"
          onSubmit={(event) => {
            event.preventDefault();
            void act("collect", {
              base_version: order.version,
              specimen_reference: specimen.trim(),
              specimen_type: sampleType.trim(),
              collected_at: collected
                ? new Date(collected).toISOString()
                : undefined,
            });
          }}
        >
          <h2 className="text-xl font-semibold">Receive specimen</h2>
          <p className="text-sm text-ink-soft">
            Verify the labelled specimen against the patient and order before
            recording receipt. Collection time is distinct from laboratory
            receipt time.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Specimen / accession reference"
              htmlFor="specimen-reference"
            >
              <input
                id="specimen-reference"
                required
                maxLength={100}
                disabled={busy}
                className={inputClass}
                value={specimen}
                onChange={(e) => setSpecimen(e.target.value)}
              />
            </Field>
            <Field label="Specimen type" htmlFor="specimen-type">
              <input
                id="specimen-type"
                required
                maxLength={100}
                disabled={busy}
                className={inputClass}
                placeholder="Use the specimen label"
                value={sampleType}
                onChange={(e) => setSampleType(e.target.value)}
              />
            </Field>
            <Field
              label="Collection date and time (if known)"
              htmlFor="specimen-collected"
            >
              <input
                id="specimen-collected"
                type="datetime-local"
                disabled={busy}
                className={inputClass}
                value={collected}
                onChange={(e) => setCollected(e.target.value)}
              />
            </Field>
          </div>
          <Button disabled={busy || !specimen.trim() || !sampleType.trim()}>
            Confirm specimen received
          </Button>
        </form>
      )}
      {order.status === "collected" &&
        (order.report_state !== "preliminary" || editing) && (
          <form onSubmit={prepare} className="space-y-5">
            <h2 className="text-xl font-semibold">
              {editing
                ? "Correct preliminary findings"
                : "Enter laboratory findings"}
            </h2>
            {editing && (
              <>
                <p className="text-sm text-ink-soft">
                  The previous preliminary version is retained in the restricted
                  report revision history. Patient results remain hidden until
                  release.
                </p>
                <Button
                  type="button"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Cancel correction
                </Button>
              </>
            )}
            <p className="text-sm text-ink-soft">
              Copy the authorized laboratory values, units and applicable
              ranges. No clinical thresholds are prefilled. Saving creates a
              preliminary report for review.
            </p>
            {rows.map((row, i) => (
              <fieldset
                key={i}
                disabled={busy}
                className="min-w-0 rounded-xl border border-line p-5"
              >
                <legend className="px-2 font-semibold">Result {i + 1}</legend>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Test / analyte" htmlFor={`analyte-${i}`}>
                    <input
                      id={`analyte-${i}`}
                      required
                      maxLength={120}
                      className={inputClass}
                      value={row.analyte}
                      onChange={(e) => change(i, "analyte", e.target.value)}
                    />
                  </Field>
                  <Field label="Result" htmlFor={`value-${i}`}>
                    <input
                      id={`value-${i}`}
                      required
                      maxLength={200}
                      className={inputClass}
                      value={row.value}
                      onChange={(e) => change(i, "value", e.target.value)}
                    />
                  </Field>
                  <Field label="Unit (if applicable)" htmlFor={`unit-${i}`}>
                    <input
                      id={`unit-${i}`}
                      maxLength={40}
                      className={inputClass}
                      value={row.unit}
                      onChange={(e) => change(i, "unit", e.target.value)}
                    />
                  </Field>
                  {bounds.map((key) => (
                    <Field
                      key={key}
                      label={`${labels[key]} (optional)`}
                      htmlFor={`${key}-${i}`}
                    >
                      <input
                        id={`${key}-${i}`}
                        type="number"
                        step="any"
                        className={inputClass}
                        value={row[key]}
                        onChange={(e) => change(i, key, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
                {rows.length > 1 && (
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      setRows((current) =>
                        current.filter((_, index) => index !== i),
                      )
                    }
                  >
                    Remove result {i + 1}
                  </Button>
                )}
              </fieldset>
            ))}
            <Button
              type="button"
              variant="quiet"
              disabled={busy || rows.length >= 100}
              onClick={() => setRows((current) => [...current, blank()])}
            >
              Add test / analyte
            </Button>
            <Field
              label="Laboratory comments / method limitations (optional)"
              htmlFor="lab-narrative"
            >
              <textarea
                id="lab-narrative"
                maxLength={4000}
                rows={4}
                disabled={busy}
                className={areaClass}
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
              />
            </Field>
            <Button disabled={busy} type="submit">
              {busy ? "Saving…" : "Save preliminary report"}
            </Button>
          </form>
        )}
      {(order.values.length > 0 || order.status === "acknowledged") && (
        <DiagnosticReport order={order} />
      )}
      {order.report_state === "preliminary" && !editing && (
        <section className="space-y-4 rounded-xl border border-line p-5">
          <h2 className="text-xl font-semibold">
            Review and authorize release
          </h2>
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => {
              setRows(
                order.values.map((value) => ({
                  analyte: value.analyte,
                  value: value.value,
                  unit: value.unit ?? "",
                  reference_low:
                    value.reference_low == null
                      ? ""
                      : String(value.reference_low),
                  reference_high:
                    value.reference_high == null
                      ? ""
                      : String(value.reference_high),
                  critical_low:
                    value.critical_low == null
                      ? ""
                      : String(value.critical_low),
                  critical_high:
                    value.critical_high == null
                      ? ""
                      : String(value.critical_high),
                })),
              );
              setNarrative(order.narrative ?? "");
              setReviewed(false);
              setEditing(true);
            }}
          >
            Correct preliminary report
          </Button>
          <p className="text-sm text-ink-soft">
            Check patient identity, specimen, every result, unit and interval
            against the laboratory source. Release records your account and
            timestamp. Final reports cannot be overwritten here.
          </p>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
              className="mt-1"
            />
            <span>I have reviewed this report and authorize its release.</span>
          </label>
          <Button
            disabled={busy || !reviewed}
            onClick={() => {
              if (
                window.confirm(
                  "Release this final report to the ordering clinician and patient?",
                )
              )
                void act("release", {
                  base_version: order.version,
                  confirm_review: true,
                });
            }}
          >
            Authorize and release final report
          </Button>
        </section>
      )}
    </div>
  );
}
