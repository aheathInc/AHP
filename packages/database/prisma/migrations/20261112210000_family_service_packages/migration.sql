CREATE TABLE "family_plans" (
 "tier" "SubscriptionTier" PRIMARY KEY, "name" VARCHAR(100) NOT NULL, "description" VARCHAR(600) NOT NULL,
 "benefits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "exclusions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "price_minor" INTEGER CHECK ("price_minor" >= 0), "currency" VARCHAR(3) NOT NULL DEFAULT 'TZS',
 "billing_period" VARCHAR(12) NOT NULL DEFAULT 'monthly' CHECK ("billing_period" IN ('monthly','annual')),
 "accepting_requests" BOOLEAN NOT NULL DEFAULT false, "version" INTEGER NOT NULL DEFAULT 1,
 "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "family_plans" (tier,name,description,benefits,exclusions) VALUES
 ('none','No package','Family administration without an assigned subscription package.',ARRAY['Family member directory','Assigned care team visibility'],ARRAY['No paid package has been assigned']),
 ('family_basic','Family Basic','A family package awaiting the service operator’s approved terms.',ARRAY[]::TEXT[],ARRAY['Benefits and prices must be confirmed before enrollment']),
 ('family_plus','Family Plus','An extended family package awaiting the service operator’s approved terms.',ARRAY[]::TEXT[],ARRAY['Benefits and prices must be confirmed before enrollment']);
CREATE TABLE "family_subscription_requests" (
 "id" UUID PRIMARY KEY, "family_id" UUID NOT NULL REFERENCES "families"(id) ON DELETE CASCADE,
 "tier" "SubscriptionTier" NOT NULL, "plan_version" INTEGER NOT NULL, "family_version" INTEGER NOT NULL,
 "requested_by_user_id" UUID NOT NULL, "client_request_id" UUID NOT NULL,
 "status" VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
 "reviewed_by_user_id" UUID, "reviewed_at" TIMESTAMP(3), "review_note" VARCHAR(600),
 "version" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "family_subscription_requests_requested_by_user_id_client_req_key" ON "family_subscription_requests" (requested_by_user_id,client_request_id);
CREATE UNIQUE INDEX "family_subscription_pending_key" ON "family_subscription_requests" (family_id) WHERE status='pending';
CREATE INDEX "family_subscription_requests_status_created_at_id_idx" ON "family_subscription_requests" (status,created_at,id);
