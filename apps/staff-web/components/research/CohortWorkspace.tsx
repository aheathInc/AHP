"use client";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { ResearchApi } from "./ResearchPortal";
import { CohortResults } from "./CohortResults";
import {
  cleanCohortFilters,
  cohortDimensions,
  dimensionLabels,
  filterSummary,
  researchTimestamp,
  type CohortFilters,
  type CohortResult,
  type CohortStudy,
  type CohortWorkspaceData,
  type SavedCohort,
} from "./cohortTypes";
import styles from "./cohorts.module.css";

export function CohortWorkspace({
  client,
  studies,
  studyId,
  onStudyChange,
  researcher,
  onExportRequested,
}: {
  client: ResearchApi;
  studies: CohortStudy[];
  studyId: string;
  onStudyChange: (id: string) => void;
  researcher: boolean;
  onExportRequested: () => void;
}) {
  const id = useId();
  const [workspace, setWorkspace] = useState<CohortWorkspaceData | null>(null);
  const [filters, setFilters] = useState<CohortFilters>({});
  const [result, setResult] = useState<CohortResult | null>(null);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [name, setName] = useState(""),
    [editing, setEditing] = useState<SavedCohort | null>(null);
  const [archiveId, setArchiveId] = useState("");
  const generation = useRef(0),
    alive = useRef(true),
    lock = useRef(false);
  const ready = workspace?.study_id === studyId ? workspace : null;
  const currentResult = result?.study_id === studyId ? result : null;
  const selectedStudy = studies.find((study) => study.id === studyId);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!studyId || !researcher) return;
      const data = await client.request<CohortWorkspaceData>(
        `/studies/${studyId}/workspace`,
        "GET",
        undefined,
        signal,
      );
      if (!signal?.aborted && alive.current) setWorkspace(data);
    },
    [client, studyId, researcher],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    generation.current++;
    setWorkspace(null);
    setResult(null);
    setFilters({});
    setName("");
    setEditing(null);
    setArchiveId("");
    setError("");
    setNotice("");
    if (!studyId || !researcher) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    void load(controller.signal)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Project workspace could not be loaded.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [studyId, researcher, load]);
  async function perform<T>(
    work: () => Promise<T>,
    success: (value: T) => void,
    message: string,
  ) {
    if (lock.current) return;
    const run = generation.current;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await work();
      if (alive.current && run === generation.current) {
        success(value);
        setNotice(message);
      }
    } catch (cause) {
      if (alive.current && run === generation.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "The request could not be confirmed. Refresh before retrying.",
        );
        setResult(null);
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function runAnalysis(saved?: SavedCohort) {
    if (!ready) return;
    void perform(
      () =>
        saved
          ? client.request<CohortResult>(`/cohorts/${saved.id}/run`, "POST", {
              base_version: saved.version,
            })
          : client.request<CohortResult>("/query", "POST", {
              study_id: studyId,
              filters: cleanCohortFilters(filters),
            }),
      (value) => {
        setResult(value);
        setFilters(value.filters);
        if (saved) {
          setEditing(saved);
          setName(saved.name);
        }
      },
      "Analysis completed against the authorized release.",
    );
  }
  function save(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const body = {
      name: name.trim(),
      filters: cleanCohortFilters(filters),
      ...(editing
        ? { base_version: editing.version }
        : { study_id: studyId, release_id: ready.release_id }),
    };
    void perform(
      async () => {
        const saved = await client.request<SavedCohort>(
          editing ? `/cohorts/${editing.id}` : "/cohorts",
          editing ? "PUT" : "POST",
          body,
        );
        const data = await client.request<CohortWorkspaceData>(
          `/studies/${studyId}/workspace`,
        );
        return { saved, data };
      },
      ({ saved, data }) => {
        setWorkspace(data);
        setEditing(saved);
        setName(saved.name);
      },
      editing
        ? "Cohort definition updated. Previous results keep their original provenance."
        : "Cohort definition saved. No patient data or result cells were stored in the definition.",
    );
  }
  function archive(saved: SavedCohort) {
    void perform(
      async () => {
        await client.request(`/cohorts/${saved.id}/archive`, "POST", {
          base_version: saved.version,
        });
        return client.request<CohortWorkspaceData>(
          `/studies/${studyId}/workspace`,
        );
      },
      (data) => {
        setWorkspace(data);
        setArchiveId("");
        if (editing?.id === saved.id) {
          setEditing(null);
          setName("");
        }
      },
      "Cohort definition archived. Its previous audit history is retained.",
    );
  }
  function exportResult(format: string) {
    if (!currentResult) return;
    void perform(
      () =>
        client.request("/exports", "POST", {
          study_id: currentResult.study_id,
          format,
          filters: currentResult.filters,
          release_id: currentResult.release_id,
          release_hash: currentResult.release_hash,
        }),
      () => onExportRequested(),
      "Export request submitted for independent output review.",
    );
  }
  const activeSaved =
    ready?.saved_cohorts.filter((saved) => saved.status === "active") ?? [];
  const stale =
    !!currentResult &&
    JSON.stringify(cleanCohortFilters(filters)) !==
      JSON.stringify(cleanCohortFilters(currentResult.filters));
  if (!researcher)
    return (
      <section className="rp-panel">
        <h2>Cohort analysis is researcher scoped</h2>
        <p className="rp-help">
          Use the review desk to govern project access and releases.
          Administrators cannot run analyses as another researcher.
        </p>
      </section>
    );
  return (
    <div className={styles.workspace} aria-busy={loading || busy}>
      <section className="rp-panel" aria-labelledby={id + "-heading"}>
        <div className="rp-panel-heading">
          <div>
            <h2 id={id + "-heading"}>Cohort workspace</h2>
            <p>
              Build a repeatable analysis from an approved aggregate release.
            </p>
          </div>
          {studyId && (
            <button
              type="button"
              className="rp-button rp-button--secondary"
              disabled={busy || loading}
              onClick={() =>
                void perform(
                  () =>
                    client.request<CohortWorkspaceData>(
                      `/studies/${studyId}/workspace`,
                    ),
                  (data) => {
                    setWorkspace(data);
                    setResult(null);
                  },
                  "Project permissions and saved definitions refreshed.",
                )
              }
            >
              Refresh project
            </button>
          )}
        </div>
        <label htmlFor={id + "-project"}>Authorized project</label>
        <select
          id={id + "-project"}
          value={studyId}
          disabled={busy}
          onChange={(event) => onStudyChange(event.target.value)}
        >
          <option value="">Select a project</option>
          {studies.map((study) => (
            <option key={study.id} value={study.id}>
              {study.title}
            </option>
          ))}
        </select>
        {!studies.length && (
          <p className={styles.empty}>
            No current approved projects are available. Complete verification,
            attach project evidence and submit your study for review in My
            projects.
          </p>
        )}
        {loading && (
          <p role="status" className={styles.loading}>
            Checking project permissions and loading published filter values…
          </p>
        )}
        {error && (
          <div role="alert" className={styles.error}>
            <strong>Request could not be completed</strong>
            <p>{error}</p>
            <p>
              Your filter selections and definition name have been kept. Refresh
              the project to check its current state.
            </p>
          </div>
        )}
        {notice && (
          <p role="status" className={styles.notice}>
            {notice}
          </p>
        )}
        {ready && (
          <>
            <dl className={styles.scope}>
              <div>
                <dt>Authorized release</dt>
                <dd>
                  {ready.release_id.slice(0, 8)} · version{" "}
                  {ready.release_version}
                </dd>
              </div>
              <div>
                <dt>Access expires</dt>
                <dd>{researchTimestamp(ready.access_expires_at)}</dd>
              </div>
              <div>
                <dt>Ethics approval expires</dt>
                <dd>{researchTimestamp(ready.ethics_expires_at)}</dd>
              </div>
              <div>
                <dt>Disclosure threshold</dt>
                <dd>
                  {ready.minimum_cell_size} participants per published cell
                </dd>
              </div>
            </dl>
            <p className={styles.help}>
              {ready.synthetic ? "Synthetic data · " : ""}
              {ready.published_cells.toLocaleString("en-GB")} published cells in
              this release. Options below come exclusively from published cells.
            </p>
            <fieldset disabled={busy} className={styles.fieldset}>
              <legend>Define the cohort</legend>
              <div className={styles.filterGrid}>
                {cohortDimensions.map((key) => (
                  <div key={key}>
                    <label htmlFor={id + "-" + key}>
                      {dimensionLabels[key]}
                    </label>
                    <select
                      id={id + "-" + key}
                      value={filters[key] ?? ""}
                      onChange={(event) =>
                        setFilters({ ...filters, [key]: event.target.value })
                      }
                    >
                      <option value="">All published values</option>
                      {ready.facets[key].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className={styles.actions}>
                <button
                  className="rp-button"
                  type="button"
                  onClick={() => runAnalysis()}
                >
                  {busy ? "Working…" : "Run analysis"}
                </button>
                <button
                  className="rp-button rp-button--secondary"
                  type="button"
                  onClick={() => {
                    setFilters({});
                    setEditing(null);
                    setName("");
                  }}
                >
                  Clear filters
                </button>
              </div>
            </fieldset>
            <form className={styles.saveForm} onSubmit={save}>
              <fieldset disabled={busy} className={styles.fieldset}>
                <legend>
                  {editing
                    ? `Edit saved definition · version ${editing.version}`
                    : "Save a reusable definition"}
                </legend>
                <p className={styles.help}>
                  Save the current filters and release reference. Use a study
                  label without patient names or identifiers.
                </p>
                <div className={styles.saveControls}>
                  <div>
                    <label htmlFor={id + "-name"}>Cohort name</label>
                    <input
                      id={id + "-name"}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      minLength={3}
                      maxLength={120}
                      required
                      placeholder="For example, adult quarterly follow-up"
                    />
                  </div>
                  <button
                    type="submit"
                    className="rp-button rp-button--secondary"
                    disabled={name.trim().length < 3}
                  >
                    {editing ? "Update definition" : "Save cohort"}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className="rp-button rp-button--secondary"
                      onClick={() => {
                        setEditing(null);
                        setName("");
                      }}
                    >
                      Save as new
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
          </>
        )}
      </section>
      {ready && (
        <section className="rp-panel" aria-labelledby={id + "-saved"}>
          <div className="rp-panel-heading">
            <div>
              <h2 id={id + "-saved"}>Saved cohorts</h2>
              <p>
                {activeSaved.length} active definitions · up to{" "}
                {ready.limits.active_cohorts} active per project
              </p>
            </div>
          </div>
          {!activeSaved.length ? (
            <div className={styles.empty}>
              <h3>No saved definitions yet</h3>
              <p>
                Set your filters and save a named cohort to return to the same
                approved release later.
              </p>
            </div>
          ) : (
            <ul className={styles.savedList}>
              {activeSaved.map((saved) => (
                <li key={saved.id}>
                  <div>
                    <h3>{saved.name}</h3>
                    <p>{filterSummary(saved.filters)}</p>
                    <small>
                      Definition v{saved.version} · updated{" "}
                      {researchTimestamp(saved.updatedAt)} · release{" "}
                      {saved.releaseId.slice(0, 8)}
                    </small>
                  </div>
                  <div className={styles.actions}>
                    {archiveId === saved.id ? (
                      <>
                        <span>Archive this definition?</span>
                        <button
                          className="rp-button rp-button--secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => archive(saved)}
                        >
                          Confirm archive
                        </button>
                        <button
                          className="rp-button rp-button--secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => setArchiveId("")}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="rp-button rp-button--secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditing(saved);
                            setName(saved.name);
                            setFilters(saved.filters);
                            setResult(null);
                            setNotice(
                              "Definition loaded. Edit its filters or run it against the current project authorization.",
                            );
                          }}
                        >
                          Load definition
                        </button>
                        <button
                          className="rp-button"
                          type="button"
                          disabled={busy}
                          onClick={() => runAnalysis(saved)}
                        >
                          Run saved cohort
                        </button>
                        <button
                          className="rp-button rp-button--secondary"
                          type="button"
                          disabled={busy}
                          onClick={() => setArchiveId(saved.id)}
                        >
                          Archive
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {ready.saved_cohorts.some((saved) => saved.status === "archived") && (
            <details className={styles.archived}>
              <summary>
                Archived definitions (
                {
                  ready.saved_cohorts.filter(
                    (saved) => saved.status === "archived",
                  ).length
                }
                )
              </summary>
              <ul>
                {ready.saved_cohorts
                  .filter((saved) => saved.status === "archived")
                  .map((saved) => (
                    <li key={saved.id}>
                      {saved.name} · version {saved.version}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {currentResult && (
        <CohortResults
          key={currentResult.queried_at + JSON.stringify(currentResult.filters)}
          result={currentResult}
          stale={stale}
          exporting={busy}
          canExport={!!ready?.allow_export && !!selectedStudy?.allowExport}
          onExport={exportResult}
        />
      )}
      {!studyId && !!studies.length && (
        <p className={styles.empty}>
          Select an authorized project to load its saved cohorts, access dates
          and published filter values.
        </p>
      )}
    </div>
  );
}
