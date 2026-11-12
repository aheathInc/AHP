"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage, idem } from "@/lib/api";
import { Button, Field, Notice, areaClass, inputClass } from "./ui";

interface Community {
  id: string;
  name: string;
  specialty: string;
}

export function NewDiscussion({ communities }: { communities: Community[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const attempt = useRef<{ signature: string; key: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (communities.length === 0) {
    return (
      <p className="mt-4 text-sm text-ink-soft">
        Hakuna jamii iliyoanzishwa bado.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mt-4">
        <Button onClick={() => setOpen(true)}>Anzisha majadiliano</Button>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = { community_id: communityId, title, body },
        signature = JSON.stringify(data);
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      await api.post(
        "/network/discussions",
        {
          ...data,
          privacy_confirmed: true,
          client_request_id: attempt.current.key,
        },
        idem(),
      );
      attempt.current = undefined;
      setOpen(false);
      setTitle("");
      setBody("");
      router.refresh();
    } catch (e) {
      setError(errorMessage(e, "Majadiliano hayakuanzishwa."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-col gap-3 border border-line bg-white p-4"
    >
      <Field label="Jamii" htmlFor="c">
        <select
          id="c"
          value={communityId}
          onChange={(e) => setCommunityId(e.target.value)}
          className={inputClass}
        >
          {communities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Kichwa" htmlFor="t">
        <input
          id="t"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field
        label="Maelezo"
        htmlFor="b"
        hint="Usiandike jina la mgonjwa wala kitu kinachoweza kumtambulisha."
      >
        <textarea
          id="b"
          required
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={areaClass}
        />
      </Field>
      {error && <Notice>{error}</Notice>}
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{" "}
        I have checked this post for patient identifiers and professional
        accuracy.
      </label>
      <div className="flex gap-3">
        <Button
          type="submit"
          disabled={busy || !title.trim() || !body.trim() || !confirmed}
        >
          Chapisha
        </Button>
        <Button type="button" variant="quiet" onClick={() => setOpen(false)}>
          Ghairi
        </Button>
      </div>
    </form>
  );
}
