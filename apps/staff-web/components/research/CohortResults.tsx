"use client";
import { useId, useMemo, useState } from "react";
import {
  cohortDimensions,
  dimensionLabels,
  filterSummary,
  researchTimestamp,
  type CohortResult,
} from "./cohortTypes";
import styles from "./cohorts.module.css";

/** Search and ordering operate on already-released cells; never regroup or derive totals. */
export function CohortResults({
  result,
  stale,
  exporting,
  canExport,
  onExport,
}: {
  result: CohortResult;
  stale: boolean;
  exporting: boolean;
  canExport: boolean;
  onExport: (format: string) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("concept");
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const cells = useMemo(() => {
    const term = search.trim().toLowerCase();
    return result.cells
      .filter((cell) =>
        `${cell.label} ${cell.code} ${cell.code_system} ${cell.region}`
          .toLowerCase()
          .includes(term),
      )
      .sort((a, b) =>
        sort === "largest"
          ? b.participants - a.participants || a.label.localeCompare(b.label)
          : sort === "smallest"
            ? a.participants - b.participants || a.label.localeCompare(b.label)
            : a.label.localeCompare(b.label) || a.code.localeCompare(b.code),
      );
  }, [result.cells, search, sort]);
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(cells.length / pageSize) - 1),
  );
  const start = currentPage * pageSize;
  return (
    <section
      className={`rp-panel ${styles.results}`}
      aria-labelledby={id + "-title"}
    >
      <div className="rp-panel-heading">
        <div>
          <h2 id={id + "-title"}>Analysis results</h2>
          <p>
            {result.saved_cohort
              ? `${result.saved_cohort.name} · definition version ${result.saved_cohort.version}`
              : "Ad hoc analysis"}{" "}
            · {result.returned_cells.toLocaleString("en-GB")} published cells
            returned
          </p>
        </div>
        <span className="rp-status">
          {result.synthetic ? "Synthetic data" : "Approved release"}
        </span>
      </div>
      {stale && (
        <p role="status" className={styles.warning}>
          Filters have changed. Run the analysis again to update these results
          and enable export requests.
        </p>
      )}
      <p className={styles.applied}>
        <strong>Applied filters</strong>
        <br />
        {filterSummary(result.filters)}
      </p>
      <div className={styles.resultTools}>
        <div>
          <label htmlFor={id + "-search"}>Find within these results</label>
          <input
            id={id + "-search"}
            type="search"
            value={search}
            maxLength={100}
            placeholder="Concept, code or region"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
        <div>
          <label htmlFor={id + "-sort"}>Sort published cells</label>
          <select
            id={id + "-sort"}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(0);
            }}
          >
            <option value="concept">Clinical concept A–Z</option>
            <option value="largest">Participants: highest first</option>
            <option value="smallest">Participants: lowest first</option>
          </select>
        </div>
      </div>
      {cells.length ? (
        <div
          className={styles.tableWrap}
          tabIndex={0}
          role="region"
          aria-label="Scrollable published aggregate cells"
        >
          <table>
            <caption>
              Published cells only. Participant counts across cells may overlap;
              do not add them to estimate unique patients.
            </caption>
            <thead>
              <tr>
                <th scope="col">Clinical concept</th>
                {cohortDimensions
                  .filter((key) => key !== "code")
                  .map((key) => (
                    <th key={key} scope="col">
                      {dimensionLabels[key]}
                    </th>
                  ))}
                <th scope="col">Participants</th>
              </tr>
            </thead>
            <tbody>
              {cells.slice(start, start + pageSize).map((cell, index) => (
                <tr key={JSON.stringify(cell) + index}>
                  <th scope="row">
                    {cell.label}
                    <small>
                      {cell.code_system} · {cell.code}
                    </small>
                  </th>
                  {cohortDimensions
                    .filter((key) => key !== "code")
                    .map((key) => (
                      <td key={key}>{cell[key]}</td>
                    ))}
                  <td className={styles.number}>
                    {cell.participants.toLocaleString("en-GB")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>
          <h3>
            {result.cells.length
              ? "No cells match this search"
              : "No releasable cells match"}
          </h3>
          <p>
            {result.cells.length
              ? "Clear or change the result search. The underlying analysis is unchanged."
              : "There may be no matching published cells, or privacy rules may have withheld them. No hidden count is disclosed."}
          </p>
        </div>
      )}
      <nav className={styles.pagination} aria-label="Result pages">
        <span role="status">
          {cells.length
            ? `Cells ${start + 1}–${Math.min(start + pageSize, cells.length)} of ${cells.length}`
            : "0 published cells displayed"}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            className="rp-button rp-button--secondary"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="rp-button rp-button--secondary"
            disabled={start + pageSize >= cells.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      </nav>
      <details className={styles.provenance}>
        <summary>Reproducibility & release provenance</summary>
        <dl>
          <div>
            <dt>Project reference</dt>
            <dd>{result.study_id}</dd>
          </div>
          <div>
            <dt>Release reference · version {result.release_version}</dt>
            <dd>{result.release_id}</dd>
          </div>
          <div>
            <dt>Release SHA-256</dt>
            <dd>{result.release_hash}</dd>
          </div>
          <div>
            <dt>Analysis completed</dt>
            <dd>{researchTimestamp(result.queried_at)}</dd>
          </div>
          <div>
            <dt>Disclosure threshold</dt>
            <dd>
              At least {result.minimum_cell_size} distinct participants per
              published cell
            </dd>
          </div>
        </dl>
        <p>{result.disclosure_notice}</p>
      </details>
      <div className={styles.export}>
        <div>
          <h3>Request a reviewed export</h3>
          <p>
            {canExport
              ? "Requests use this analysis’s exact filters and release. A separate output review is required before download."
              : "This project does not include export permission."}{" "}
            Searching or sorting the table does not change an export request.
          </p>
        </div>
        {canExport && (
          <div className={styles.actions}>
            {["csv", "xlsx", "json", "xml"].map((format) => (
              <button
                key={format}
                type="button"
                className="rp-button rp-button--secondary"
                disabled={stale || exporting}
                onClick={() => onExport(format)}
              >
                Request {format === "xlsx" ? "Excel" : format.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
