export const cohortDimensions = [
  "age_band",
  "sex",
  "region",
  "period",
  "domain",
  "code",
] as const;
export type CohortDimension = (typeof cohortDimensions)[number];
export type CohortFilters = Partial<Record<CohortDimension, string>>;
export const dimensionLabels: Record<CohortDimension, string> = {
  age_band: "Age group",
  sex: "Sex",
  region: "Region",
  period: "Reporting period",
  domain: "Clinical domain",
  code: "Clinical code",
};
export interface CohortStudy {
  id: string;
  title: string;
  expiresAt: string;
  ethicsExpiresAt: string;
  allowExport: boolean;
}
export interface SavedCohort {
  id: string;
  studyId: string;
  releaseId: string;
  name: string;
  filters: CohortFilters;
  status: string;
  version: number;
  updatedAt: string;
}
export interface CohortWorkspaceData {
  study_id: string;
  release_id: string;
  release_hash: string;
  release_version: number;
  minimum_cell_size: number;
  synthetic: boolean;
  published_cells: number;
  facets: Record<CohortDimension, string[]>;
  access_expires_at: string;
  ethics_expires_at: string;
  allow_export: boolean;
  saved_cohorts: SavedCohort[];
  limits: { active_cohorts: number; total_cohorts: number };
}
export interface CohortCell {
  age_band: string;
  sex: string;
  region: string;
  period: string;
  domain: string;
  code_system: string;
  code: string;
  label: string;
  participants: number;
}
export interface CohortResult {
  study_id: string;
  release_id: string;
  release_hash: string;
  release_version: number;
  queried_at: string;
  filters: CohortFilters;
  minimum_cell_size: number;
  synthetic: boolean;
  returned_cells: number;
  cells: CohortCell[];
  disclosure_notice: string;
  saved_cohort?: { id: string; name: string; version: number };
}
export const cleanCohortFilters = (filters: CohortFilters): CohortFilters =>
  Object.fromEntries(
    cohortDimensions
      .filter((key) => filters[key])
      .map((key) => [key, filters[key]]),
  );
export const filterSummary = (filters: CohortFilters) =>
  cohortDimensions
    .filter((key) => filters[key])
    .map((key) => `${dimensionLabels[key]}: ${filters[key]}`)
    .join(" · ") || "All approved published cells";
export function researchTimestamp(iso: string) {
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(iso)) + " UTC"
  );
}
