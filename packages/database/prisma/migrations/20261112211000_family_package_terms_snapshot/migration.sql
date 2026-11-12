ALTER TABLE family_subscription_requests ADD COLUMN plan_snapshot JSONB NOT NULL DEFAULT '{}';
