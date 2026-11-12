ALTER TABLE "discussions" ADD COLUMN "client_request_id" UUID, ADD COLUMN "hidden_at" TIMESTAMP(3), ADD COLUMN "moderated_by_user_id" UUID;
CREATE UNIQUE INDEX "network_post_request_key" ON "discussions"("author_clinician_id","client_request_id");
ALTER TABLE "discussion_replies" ADD COLUMN "client_reply_id" UUID, ADD COLUMN "hidden_at" TIMESTAMP(3), ADD COLUMN "moderated_by_user_id" UUID;
CREATE UNIQUE INDEX "network_reply_request_key" ON "discussion_replies"("discussion_id","author_clinician_id","client_reply_id");
CREATE TABLE "professional_content_reports" (
 "id" UUID NOT NULL PRIMARY KEY,"discussion_id" UUID NOT NULL REFERENCES "discussions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "reply_id" UUID,"target_key" VARCHAR(40) NOT NULL,"reporter_clinician_id" UUID NOT NULL,"category" VARCHAR(30) NOT NULL,
 "status" VARCHAR(20) NOT NULL DEFAULT 'open',"reviewer_user_id" UUID,"reviewed_at" TIMESTAMP(3),"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"version" INTEGER NOT NULL DEFAULT 1,
 CONSTRAINT "professional_report_category" CHECK ("category" IN ('privacy','misinformation','conduct','spam')),
 CONSTRAINT "professional_report_status" CHECK ("status" IN ('open','hidden','dismissed'))
);
CREATE UNIQUE INDEX "network_report_target_key" ON "professional_content_reports"("discussion_id","reporter_clinician_id","target_key");
CREATE INDEX "professional_content_reports_status_created_at_id_idx" ON "professional_content_reports"("status","created_at","id");
