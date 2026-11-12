"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, errorMessage, idem } from "@/lib/api";
import { Button, Field, Notice, areaClass, inputClass } from "./ui";

const OPTIONS = [
  { code: "Complete Blood Count (CBC)", type: "laboratory" },
  { code: "Malaria rapid diagnostic test", type: "point_of_care" },
  { code: "Chest X-ray", type: "imaging" },
] as const;

export function OrderInvestigation({
  careThreadId,
  consultationId,
}: {
  careThreadId: string;
  consultationId: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [customType, setCustomType] = useState("laboratory");
  const request = useRef<{
    fingerprint: string;
    options: ReturnType<typeof idem>;
  }>();
  const lock = useRef(false);
  const [notes, setNotes] = useState("");
  const [urgency, setUrgency] = useState("routine");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [facilityId, setFacilityId] = useState("");
  const [facilityError, setFacilityError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api
      .get<{ data: { id: string; name: string }[] }>("/laboratory/facilities")
      .then(({ data }) => {
        if (active) setFacilities(data.data);
      })
      .catch(() => {
        if (active)
          setFacilityError(
            "Laboratory destinations could not be loaded. Reload this page to retry.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const selected =
    code === "custom"
      ? { code: customCode.trim(), type: customType }
      : OPTIONS.find((o) => o.code === code);
  const needsDestination = selected && selected.type !== "imaging";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      lock.current ||
      !selected ||
      !selected.code ||
      (needsDestination && !facilityId)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setOrderId(null);
    try {
      const body = {
        care_thread_id: careThreadId,
        consultation_id: consultationId,
        investigation_code: selected.code,
        investigation_type: selected.type,
        urgency,
        clinical_notes: notes.trim() || undefined,
        facility_id:
          needsDestination && facilityId !== "__clinician__"
            ? facilityId
            : undefined,
      };
      const fingerprint = JSON.stringify(body);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, options: idem() };
      const res = await api.post(
        "/investigation-orders",
        body,
        request.current.options,
      );
      request.current = undefined;
      setOrderId(res.data.id);
      setNotes("");
      router.refresh();
    } catch (e) {
      setError(
        errorMessage(e, "The investigation order could not be created."),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-line bg-white p-4 shadow-sm"
    >
      <h2 className="text-base font-semibold">Order investigation</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Investigation" htmlFor="investigation-code">
          <select
            required
            disabled={busy}
            id="investigation-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputClass}
          >
            <option value="">Select an investigation</option>
            {OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.code}
              </option>
            ))}
            <option value="custom">
              Other test — use approved laboratory code
            </option>
          </select>
        </Field>
        <div className="self-end text-sm text-ink-soft">{selected?.type}</div>
      </div>
      {code === "custom" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            label="Approved test name / code"
            htmlFor="custom-investigation-code"
          >
            <input
              id="custom-investigation-code"
              className={inputClass}
              required
              maxLength={40}
              disabled={busy}
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
            />
          </Field>
          <Field label="Investigation type" htmlFor="custom-investigation-type">
            <select
              id="custom-investigation-type"
              className={inputClass}
              disabled={busy}
              value={customType}
              onChange={(e) => setCustomType(e.target.value)}
            >
              <option value="laboratory">Laboratory</option>
              <option value="imaging">Imaging</option>
              <option value="pathology">Pathology</option>
              <option value="point_of_care">Point of care</option>
            </select>
          </Field>
        </div>
      )}
      <div className="mt-3">
        {needsDestination && (
          <Field
            label="Destination laboratory"
            htmlFor="investigation-facility"
            hint="Only staff assigned to the selected facility can receive this order."
          >
            <select
              id="investigation-facility"
              required
              disabled={busy}
              className={inputClass}
              value={facilityId}
              onChange={(e) => setFacilityId(e.target.value)}
            >
              <option value="">Select a destination</option>
              <option value="__clinician__">
                Clinician-managed — no laboratory delivery
              </option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {facilityError && <Notice>{facilityError}</Notice>}
      </div>
      <div className="mt-3">
        <Field
          label="Clinical notes"
          htmlFor="investigation-notes"
          hint="Optional"
        >
          <textarea
            id="investigation-notes"
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={areaClass}
            rows={3}
          />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Clinical priority" htmlFor="investigation-urgency">
          <select
            id="investigation-urgency"
            className={inputClass}
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
            disabled={busy}
          >
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="emergency">Emergency</option>
          </select>
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          disabled={
            busy ||
            !selected ||
            !selected.code ||
            !!(needsDestination && !facilityId)
          }
        >
          {busy ? "Ordering..." : "Order investigation"}
        </Button>
        {orderId && (
          <Link
            href={`/doctor/diagnostics/${orderId}`}
            className="text-sm text-petrol underline underline-offset-4"
          >
            Open order
          </Link>
        )}
      </div>
      {error && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}
    </form>
  );
}
