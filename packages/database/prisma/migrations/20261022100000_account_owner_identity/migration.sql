DROP INDEX "tiktok_accounts_username_key";
CREATE UNIQUE INDEX "tiktok_accounts_owner_id_username_key" ON "tiktok_accounts"("owner_id", "username");
