import { test } from "node:test";
import assert from "node:assert/strict";
import { localRegistrationSimulationAllowed } from "../routes/registration.routes.js";
const approved = {
  nodeEnv: "test",
  mode: "console",
  databaseUrl:
    "postgresql://runner:synthetic@127.0.0.1:55439/ahealth_test?schema=public",
  testAcknowledgement: "ISOLATED_DISPOSABLE_AHEALTH_TEST",
};
test("simulation is allowed only for acknowledged isolated tests or the existing local development target", () => {
  assert.equal(localRegistrationSimulationAllowed(approved), true);
  assert.equal(
    localRegistrationSimulationAllowed({
      ...approved,
      testAcknowledgement: undefined,
    }),
    false,
  );
  assert.equal(
    localRegistrationSimulationAllowed({ ...approved, nodeEnv: "production" }),
    false,
  );
  assert.equal(
    localRegistrationSimulationAllowed({ ...approved, nodeEnv: "development" }),
    false,
  );
  assert.equal(
    localRegistrationSimulationAllowed({ ...approved, mode: "flutterwave" }),
    false,
  );
  for (const databaseUrl of [
    "postgresql://runner@127.0.0.1:5432/ahealth_test?schema=public",
    "postgresql://runner@db.example:55439/ahealth_test?schema=public",
    "postgresql://runner@127.0.0.1:55439/production?schema=public",
    "invalid",
  ])
    assert.equal(
      localRegistrationSimulationAllowed({ ...approved, databaseUrl }),
      false,
    );
  assert.equal(
    localRegistrationSimulationAllowed({
      ...approved,
      nodeEnv: "development",
      databaseUrl:
        "postgresql://runner@127.0.0.1:55432/ahealth_dev?schema=ahp_test",
    }),
    true,
  );
});
