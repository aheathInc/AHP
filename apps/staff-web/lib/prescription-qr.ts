/** QR carries only the existing opaque handoff reference, never a URL or patient data. */
export function prescriptionReference(value: string): string | null {
  const reference = value.trim();
  return /^[A-Za-z0-9_-]{43}$/.test(reference) ? reference : null;
}

export function cameraError(error: unknown): string {
  // DOMException does not inherit Error in every supported browser.
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was denied. Allow camera access in your browser and try again, or enter the reference manually.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No usable camera was found. Connect a camera or enter the reference manually.";
  }
  if (name === "NotReadableError") {
    return "The camera is busy or unavailable. Close other camera apps and try again, or enter the reference manually.";
  }
  return "The camera could not start. Try again or enter the reference manually.";
}
