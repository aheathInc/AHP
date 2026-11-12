"use client";

import { useEffect, useRef, useState } from "react";
import { cameraError, prescriptionReference } from "@/lib/prescription-qr";

interface Props {
  onRead: (reference: string) => void;
  onClose: () => void;
}

export function PrescriptionQrScanner({ onRead, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let closed = false;
    let stream: MediaStream | undefined;
    let controls: { stop: () => void } | undefined;
    const element = video.current;
    function stop() {
      closed = true;
      controls?.stop();
      stream?.getTracks().forEach((track) => track.stop());
      if (element) element.srcObject = null;
    }
    function hide() {
      if (document.hidden) {
        stop();
        onClose();
      }
    }
    function leave() {
      stop();
      onClose();
    }
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    async function start() {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(
          "Camera scanning requires HTTPS or localhost and a supported browser. You can still enter the reference manually.",
        );
        return;
      }
      try {
        // Load the decoder only after the pharmacist requests a scan.
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (closed || !element) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        // Permission can be granted after the user closes the scanner.
        if (closed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        controls = await new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 250,
        }).decodeFromStream(stream, element, (result, _error, scanner) => {
          if (closed || !result) return;
          const reference = prescriptionReference(result.getText());
          if (!reference) {
            setError(
              "This QR is not a prescription reference. Scan the QR shown in the patient’s A-Health medicines screen.",
            );
            return;
          }
          scanner.stop();
          stop();
          onRead(reference);
        });
        if (closed) controls.stop();
        else setReady(true);
      } catch (reason) {
        if (!closed) {
          stop();
          setError(cameraError(reason));
        }
      }
    }
    void start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
    };
  }, [onRead, onClose]);

  return (
    <section
      aria-label="Scan prescription QR"
      className="space-y-3 rounded-lg border border-line p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Scan the patient’s prescription QR</h2>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="min-h-11 rounded border border-line px-3 py-2 text-sm"
        >
          Close camera
        </button>
      </div>
      <p className="text-sm text-ink-soft">
        Hold the QR inside the camera view. Scanning fills the reference; verify
        it before recording any dispensing.
      </p>
      <video
        ref={video}
        muted
        playsInline
        aria-label="Prescription QR camera preview"
        className="aspect-[4/3] w-full max-w-lg rounded bg-black object-contain"
      />
      {!ready && !error && (
        <p role="status" className="text-sm">
          Waiting for camera access…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
