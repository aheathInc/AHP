CREATE TABLE "research_saved_cohorts" (
  "id" UUID NOT NULL,
  "study_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "filters" JSONB NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'active',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_saved_cohorts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_saved_cohorts_study_id_fkey" FOREIGN KEY ("study_id") REFERENCES "research_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_saved_cohorts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_saved_cohorts_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "research_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "research_saved_cohorts_status_check" CHECK ("status" IN ('active', 'archived')),
  CONSTRAINT "research_saved_cohorts_version_check" CHECK ("version" >= 1)
);
CREATE UNIQUE INDEX "research_saved_cohorts_study_id_name_key" ON "research_saved_cohorts"("study_id", "name");
CREATE INDEX "research_saved_cohorts_owner_id_study_id_status_idx" ON "research_saved_cohorts"("owner_id", "study_id", "status");
