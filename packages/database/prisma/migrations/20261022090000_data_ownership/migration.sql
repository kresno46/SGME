ALTER TABLE "tiktok_accounts" ADD COLUMN "owner_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD COLUMN "owner_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outreach_tasks" ADD COLUMN "owner_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Legacy business data stays with the sole Super Admin; ambiguous ownership stays unassigned and Super-Admin-only.
UPDATE "tiktok_accounts" SET "owner_id" = (SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='SUPER_ADMIN' AND (SELECT count(*) FROM users u2 JOIN roles r2 ON r2.id=u2.role_id WHERE r2.code='SUPER_ADMIN')=1 LIMIT 1);
UPDATE "leads" SET "owner_id" = (SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.code='SUPER_ADMIN' AND (SELECT count(*) FROM users u2 JOIN roles r2 ON r2.id=u2.role_id WHERE r2.code='SUPER_ADMIN')=1 LIMIT 1);
UPDATE "outreach_tasks" t SET "owner_id"=l.owner_id FROM leads l WHERE t.lead_id=l.id;
CREATE INDEX "tiktok_accounts_owner_id_idx" ON "tiktok_accounts"("owner_id");
CREATE INDEX "leads_owner_id_idx" ON "leads"("owner_id");
CREATE INDEX "outreach_tasks_owner_id_idx" ON "outreach_tasks"("owner_id");
DROP INDEX "leads_tiktok_username_normalized_key";
DROP INDEX "leads_email_normalized_key";
DROP INDEX "leads_phone_normalized_key";
CREATE UNIQUE INDEX "leads_owner_id_tiktok_username_normalized_key" ON "leads"("owner_id","tiktok_username_normalized");
CREATE UNIQUE INDEX "leads_owner_id_email_normalized_key" ON "leads"("owner_id","email_normalized");
CREATE UNIQUE INDEX "leads_owner_id_phone_normalized_key" ON "leads"("owner_id","phone_normalized");
