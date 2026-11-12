import { test } from "node:test";
import assert from "node:assert/strict";
import {
  prescriptionReference,
  cameraError,
} from "../../lib/prescription-qr.js";
const reference = "aB_9-".repeat(8) + "abc";
test("accepts only opaque references, never URLs or clinical JSON", () => {
  assert.equal(prescriptionReference(" " + reference + " "), reference);
  for (const value of [
    "",
    reference + "x",
    "https://example.com/" + reference,
    JSON.stringify({ reference }),
    "x".repeat(10000),
    "a".repeat(42) + "!",
  ])
    assert.equal(prescriptionReference(value), null);
});
test("camera errors offer recovery without removing manual entry", () => {
  assert.match(cameraError({ name: "NotAllowedError" }), /denied/);
  for (const name of [
    "NotAllowedError",
    "SecurityError",
    "NotFoundError",
    "NotReadableError",
    "OverconstrainedError",
    "Other",
  ]) {
    const error = new Error();
    error.name = name;
    assert.match(cameraError(error), /manually/);
  }
});
