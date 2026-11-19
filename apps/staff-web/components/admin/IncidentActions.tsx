"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage, idem, type IncidentReport } from "@/lib/api";
import { Button } from "@/components/ui";
import styles from "./operations.module.css";

const transitions: Record<
  string,
  { value: "under_investigation" | "action_taken" | "closed"; label: string }[]
> = {
  reported: [{ value: "under_investigation", label: "Start investigation" }],
  under_investigation: [
    { value: "action_taken", label: "Record action taken" },
  ],
  action_taken: [
    { value: "closed", label: "Close incident" },
    { value: "under_investigation", label: "Return to investigation" },
  ],
  closed: [{ value: "under_investigation", label: "Reopen investigation" }],
};
export function IncidentActions({ incident }: { incident: IncidentReport }) {
  const options = transitions[incident.status] ?? [];
  const [next, setNext] = useState(options[0]?.value ?? "under_investigation");
  const [notes, setNotes] = useState(incident.investigation_notes ?? "");
  const [action, setAction] = useState(incident.action_taken ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const locked = useRef(false);
  const attempt = useRef<{
    payload: string;
    config: ReturnType<typeof idem>;
  }>();
  const router = useRouter();
  const investigating = next === "under_investigation";
  const ready =
    confirmed &&
    (investigating ? notes.trim().length >= 5 : action.trim().length >= 5);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current || !ready) return;
    const body = {
      status: next,
      expected_version: incident.version,
      ...(notes.trim() ? { investigation_notes: notes.trim() } : {}),
      ...(action.trim() ? { action_taken: action.trim() } : {}),
    };
    const payload = JSON.stringify(body);
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, config: idem() };
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.patch(
        `/incident-reports/${incident.id}`,
        body,
        attempt.current!.config,
      );
      setSaved(true);
      router.refresh();
    } catch (error) {
      setError(
        errorMessage(
          error,
          "The update could not be saved. Your notes have been kept. Try again.",
        ),
      );
    } finally {
      setBusy(false);
      locked.current = false;
    }
  }
  if (!options.length) return null;
  if (saved)
    return (
      <p role="status" className={styles.feedback}>
        Incident update recorded.
      </p>
    );
  return (
    <form onSubmit={submit} className={styles.decision}>
      <fieldset disabled={busy}>
        <legend>Update governance status</legend>
        <label htmlFor={`incident-status-${incident.id}`}>Next step</label>
        <select
          id={`incident-status-${incident.id}`}
          value={next}
          onChange={(e) => {
            setNext(e.target.value as typeof next);
            setConfirmed(false);
          }}
        >
          {options.map((x) => (
            <option key={x.value} value={x.value}>
              {x.label}
            </option>
          ))}
        </select>
        <div className="mt-4">
          <label htmlFor={`incident-note-${incident.id}`}>
            {investigating
              ? incident.status === "closed"
                ? "Reason for reopening and investigation plan"
                : "Investigation plan"
              : "Action taken and outcome"}
          </label>
          <textarea
            id={`incident-note-${incident.id}`}
            value={investigating ? notes : action}
            onChange={(e) =>
              investigating
                ? setNotes(e.target.value)
                : setAction(e.target.value)
            }
            required
            minLength={5}
            maxLength={4000}
            rows={4}
            aria-describedby={`incident-note-help-${incident.id}`}
          />
          <p id={`incident-note-help-${incident.id}`} className={styles.helper}>
            Record the next step and relevant findings. Use the case reference
            rather than unnecessary patient identifiers.
          </p>
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            required
          />
          <span>
            {next === "closed"
              ? "I have reviewed the recorded action and confirm that this incident can be closed."
              : "I have reviewed this report and confirm the next step."}
          </span>
        </label>
        <div className={styles.buttons}>
          <Button type="submit" disabled={busy || !ready}>
            {busy
              ? "Saving update…"
              : options.find((x) => x.value === next)?.label}
          </Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </form>
  );
}
