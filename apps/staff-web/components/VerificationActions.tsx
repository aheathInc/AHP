"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage, idem } from "@/lib/api";
import { Button } from "./ui";
import styles from "./admin/operations.module.css";

export function VerificationActions({
  clinicianId,
  clinicianName = "this clinician",
  expectedVersion,
}: {
  clinicianId: string;
  clinicianName?: string;
  expectedVersion?: number;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const locked = useRef(false);
  const attempt = useRef<{
    payload: string;
    config: ReturnType<typeof idem>;
  }>();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      locked.current ||
      !reviewed ||
      (decision === "reject" && reason.trim().length < 5)
    )
      return;
    const body = {
      decision,
      ...(expectedVersion ? { expected_version: expectedVersion } : {}),
      ...(decision === "reject" ? { reason: reason.trim() } : {}),
    };
    const payload = JSON.stringify(body);
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, config: idem() };
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/clinicians/${clinicianId}/verification`,
        body,
        attempt.current!.config,
      );
      setSaved(
        decision === "approve" ? "Approval recorded." : "Rejection recorded.",
      );
      router.refresh();
    } catch (error) {
      setError(
        errorMessage(
          error,
          "The decision could not be saved. Your review has been kept; try again.",
        ),
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (saved)
    return (
      <p className={styles.feedback} role="status">
        {saved}
      </p>
    );
  return (
    <form onSubmit={submit} className={styles.decision}>
      <fieldset disabled={busy}>
        <legend>Record a verification decision</legend>
        <label htmlFor={`decision-${clinicianId}`}>
          Decision for {clinicianName}
        </label>
        <select
          id={`decision-${clinicianId}`}
          value={decision}
          onChange={(e) => {
            setDecision(e.target.value as "approve" | "reject");
            setReviewed(false);
            setError(null);
          }}
        >
          <option value="approve">Approve credentials</option>
          <option value="reject">Reject application</option>
        </select>
        {decision === "reject" && (
          <div className="mt-4">
            <label htmlFor={`reason-${clinicianId}`}>
              Reason for rejection
            </label>
            <textarea
              id={`reason-${clinicianId}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={1000}
              required
              aria-describedby={`reason-help-${clinicianId}`}
            />
            <p id={`reason-help-${clinicianId}`} className={styles.helper}>
              Give an actionable explanation. Do not include patient
              information. Minimum 5 characters.
            </p>
          </div>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
            required
          />
          <span>
            I have reviewed the clinician&apos;s identity and licence evidence
            using the approved verification process.
          </span>
        </label>
        <p className={styles.helper}>
          {decision === "approve"
            ? "Approval can make this clinician eligible for care routing. Confirm the evidence before recording your decision."
            : "The clinician will not be eligible for care routing. The reason will be retained with the application."}
        </p>
        <div className={styles.buttons}>
          <Button
            type="submit"
            variant={decision === "reject" ? "danger" : "primary"}
            disabled={
              busy ||
              !reviewed ||
              (decision === "reject" && reason.trim().length < 5)
            }
          >
            {busy
              ? "Saving decision…"
              : decision === "approve"
                ? "Confirm approval"
                : "Confirm rejection"}
          </Button>
        </div>
      </fieldset>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
