import type {
  Actor,
  Collection,
  Filters,
  Release,
  Study,
  Tx,
} from "./types.js";
import type { ExtensionContext } from "./extensions.js";
import { check, filterCells, keys, parseFilters, text } from "./policy.js";

export const COHORT_FILTERS = [
  "age_band",
  "sex",
  "region",
  "period",
  "domain",
  "code",
] as const;

/** Result provenance is derived from the exact authorized release and applied filters. */
export function cohortResult(
  study: Study,
  dataset: Collection,
  release: Release,
  filters: Filters,
  now: Date,
) {
  const cells = filterCells(release.cells, filters);
  return {
    study_id: study.id,
    release_id: release.id,
    release_hash: release.contentHash,
    release_version: release.version,
    queried_at: now.toISOString(),
    filters,
    minimum_cell_size: release.minimumCellSize,
    synthetic: dataset.syntheticOnly,
    fee_tzs: 0,
    cells,
    returned_cells: cells.length,
    disclosure_notice:
      "Only published cells are returned. Hidden small cells and totals are not exposed. Counts across cells may overlap and must not be summed as unique patients.",
  };
}

export async function cohortOperation(
  tx: Tx,
  actor: Actor,
  operation: string,
  input: Record<string, unknown>,
  context: ExtensionContext,
  now: Date,
) {
  context.researcher(actor);
  if (operation === "cohort.workspace") {
    keys(input, ["id"]);
    const { study, dataset, release } = await context.approvedStudy(
      tx,
      actor,
      input.id,
    );
    const saved = await tx.list(
      "cohort",
      { studyId: study.id, ownerId: actor.sub },
      101,
    );
    check(
      saved.length <= 100,
      422,
      "COHORT_CAPACITY_LIMIT",
      "This project exceeds the saved cohort limit. Contact research support.",
    );
    const facets = Object.fromEntries(
      COHORT_FILTERS.map((key) => [
        key,
        [...new Set(release.cells.map((cell) => cell[key]))].sort(),
      ]),
    );
    await context.audit(tx, actor, "cohort_workspace_opened", study.id, {
      releaseId: release.id,
    });
    return {
      study_id: study.id,
      release_id: release.id,
      release_hash: release.contentHash,
      release_version: release.version,
      minimum_cell_size: release.minimumCellSize,
      synthetic: dataset.syntheticOnly,
      published_cells: release.cells.length,
      facets,
      access_expires_at: study.expiresAt.toISOString(),
      ethics_expires_at: study.ethicsExpiresAt.toISOString(),
      allow_export: study.allowExport,
      saved_cohorts: saved,
      limits: { active_cohorts: 50, total_cohorts: 100 },
    };
  }
  if (operation === "cohort.create") {
    keys(input, ["study_id", "name", "filters", "release_id"]);
    const { study, release } = await context.approvedStudy(
      tx,
      actor,
      input.study_id,
    );
    check(
      input.release_id === release.id,
      409,
      "RELEASE_CHANGED",
      "The approved release changed. Reload the workspace before saving.",
    );
    const name = text(input, "name", 3, 120),
      filters = parseFilters(input.filters);
    const existing = await tx.list("cohort", { studyId: study.id }, 101);
    check(
      existing.length < 100 &&
        existing.filter((row) => row.status === "active").length < 50,
      422,
      "COHORT_CAPACITY_LIMIT",
      "A project supports 50 active definitions and 100 total definitions. Archive unused cohorts or use a separate approved project.",
    );
    check(
      !existing.some((row) => row.name.toLowerCase() === name.toLowerCase()),
      409,
      "COHORT_NAME_EXISTS",
      "Use a different cohort name; this project already has that definition name.",
    );
    const saved = await tx.insert("cohort", {
      ...context.row(),
      studyId: study.id,
      ownerId: actor.sub,
      releaseId: release.id,
      name,
      filters,
      status: "active",
    });
    await context.audit(tx, actor, "cohort_saved", saved.id, {
      studyId: study.id,
      releaseId: release.id,
    });
    return saved;
  }
  keys(
    input,
    operation === "cohort.update"
      ? ["id", "base_version", "name", "filters"]
      : ["id", "base_version"],
  );
  const saved = await context.required(tx, "cohort", input.id);
  check(
    saved.ownerId === actor.sub,
    403,
    "NOT_RESOURCE_OWNER",
    "This saved cohort belongs to another researcher.",
  );
  context.matchVersion(saved, input);
  check(
    saved.status === "active",
    409,
    "COHORT_ARCHIVED",
    "This cohort definition has been archived.",
  );
  if (operation === "cohort.archive") {
    // Owners may retire a definition even after project access expires; no data is returned.
    const result = await context.update(tx, "cohort", saved, {
      status: "archived",
    });
    await context.audit(tx, actor, "cohort_archived", saved.id, {
      studyId: saved.studyId,
    });
    return result;
  }
  const { study, dataset, release } = await context.approvedStudy(
    tx,
    actor,
    saved.studyId,
  );
  check(
    saved.releaseId === release.id,
    409,
    "RELEASE_CHANGED",
    "This definition belongs to a different release. Create a new definition for the currently approved release.",
  );
  if (operation === "cohort.update") {
    const name = text(input, "name", 3, 120),
      filters = parseFilters(input.filters);
    const siblings = await tx.list("cohort", { studyId: saved.studyId }, 101);
    check(
      !siblings.some(
        (row) =>
          row.id !== saved.id && row.name.toLowerCase() === name.toLowerCase(),
      ),
      409,
      "COHORT_NAME_EXISTS",
      "Use a different cohort name.",
    );
    const result = await context.update(tx, "cohort", saved, { name, filters });
    await context.audit(tx, actor, "cohort_updated", saved.id, {
      studyId: saved.studyId,
    });
    return result;
  }
  check(
    operation === "cohort.run",
    404,
    "UNKNOWN_ACTION",
    "Unknown cohort action.",
  );
  const result = cohortResult(
    study,
    dataset,
    release,
    parseFilters(saved.filters),
    now,
  );
  await context.audit(tx, actor, "cohort_run", saved.id, {
    studyId: study.id,
    releaseId: release.id,
    version: saved.version,
    returnedCells: result.cells.length,
  });
  return {
    ...result,
    saved_cohort: { id: saved.id, name: saved.name, version: saved.version },
  };
}
