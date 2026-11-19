import styles from "./cohorts.module.css";
export function projectState(
  study: { status: string; expiresAt: string; ethicsExpiresAt: string },
  now = Date.now(),
) {
  return study.status === "approved" &&
    (new Date(study.expiresAt).getTime() <= now ||
      new Date(study.ethicsExpiresAt).getTime() <= now)
    ? "expired"
    : study.status;
}
export function StudyReadiness({
  study,
  identityVerified,
  evidence,
}: {
  study: {
    id: string;
    status: string;
    expiresAt: string;
    ethicsExpiresAt: string;
    allowExport: boolean;
    allowEcrf: boolean;
  };
  identityVerified: boolean;
  evidence: { kind: string; scanStatus: string }[];
}) {
  const required = ["protocol", "ethics", "controller"];
  const missing = required.filter(
    (kind) =>
      !evidence.some(
        (document) => document.kind === kind && document.scanStatus === "clean",
      ),
  );
  const expired =
    new Date(study.expiresAt).getTime() <= Date.now() ||
    new Date(study.ethicsExpiresAt).getTime() <= Date.now();
  const stages = [
    [
      "Researcher identity",
      identityVerified ? "Verified" : "Verification required",
    ],
    [
      "Project evidence",
      missing.length
        ? `Missing: ${missing.map((kind) => (kind === "controller" ? "controller authorization" : kind)).join(", ")}`
        : "Required scanned documents attached",
    ],
    [
      "Governance review",
      study.status === "approved"
        ? "Approval recorded"
        : study.status.replaceAll("_", " "),
    ],
    [
      "Authorization dates",
      expired
        ? "Expired · access unavailable"
        : "Within recorded approval dates",
    ],
  ];
  return (
    <div className={styles.readiness}>
      <dl>
        {stages.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        Requested scope: aggregate analysis
        {study.allowExport ? " · reviewed exports" : ""}
        {study.allowEcrf ? " · eCRF collection" : ""}. Each analysis rechecks
        current identity, project, source and release permissions.
      </p>
    </div>
  );
}
