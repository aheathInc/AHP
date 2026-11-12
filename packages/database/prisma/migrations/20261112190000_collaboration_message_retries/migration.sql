ALTER TABLE "provider_clinical_collaboration_messages" ADD COLUMN "client_message_id" UUID;
CREATE UNIQUE INDEX "collaboration_message_client_key" ON "provider_clinical_collaboration_messages"("collaboration_id","author_clinician_id","client_message_id");
