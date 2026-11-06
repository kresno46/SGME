-- Raise the previous default without replacing custom admin limits.
UPDATE "system_settings"
SET "value" = '40'::jsonb, "updated_at" = CURRENT_TIMESTAMP
WHERE "key" = 'outbound.daily_task_limit_per_account'
  AND "value" = '30'::jsonb;
