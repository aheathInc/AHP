"use client";
import { useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import { Button, Notice, inputClass } from "./ui";
export function NetworkReport({
  discussionId,
  replyId,
  onAccessLost,
}: {
  discussionId: string;
  replyId?: string;
  onAccessLost?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [category, setCategory] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function report(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !category) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/network/discussions/${discussionId}/report`, {
        category,
        ...(replyId ? { reply_id: replyId } : {}),
      });
      setOpen(false);
      setNotice(
        "Report recorded for moderator review. Reporting does not automatically remove content.",
      );
    } catch (cause) {
      setError(
        errorMessage(cause, "The report could not be confirmed. Try again."),
      );
      const status = (cause as { response?: { status: number } }).response
        ?.status;
      if (status === 401 || status === 403) onAccessLost?.();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="text-sm">
      {notice ? (
        <p role="status">{notice}</p>
      ) : (
        <Button
          type="button"
          variant="quiet"
          onClick={() => setOpen((value) => !value)}
          disabled={busy}
        >
          {open ? "Cancel report" : "Report concern"}
        </Button>
      )}
      {error && <Notice>{error}</Notice>}
      {open && (
        <form
          onSubmit={report}
          className="mt-3 space-y-3 rounded-lg border border-line p-3"
        >
          <label className="block">
            Reason for reporting
            <select
              aria-label="Reason for reporting"
              className={inputClass}
              value={category}
              required
              disabled={busy}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">Select a concern</option>
              <option value="privacy">Patient identifiers / privacy</option>
              <option value="misinformation">
                Potentially unsafe or misleading content
              </option>
              <option value="conduct">Professional conduct</option>
              <option value="spam">Spam / irrelevant promotion</option>
            </select>
          </label>
          <p className="text-ink-soft">
            Do not repeat patient information in a report. A moderator will
            review the existing contribution.
          </p>
          <Button disabled={busy || !category}>Submit report</Button>
        </form>
      )}
    </div>
  );
}
