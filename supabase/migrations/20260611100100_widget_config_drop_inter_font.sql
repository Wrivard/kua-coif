-- Plan 038 (CORRECTNESS-06) — retire the dead 'inter' widget font option.
--
-- The settings UI offered "Inter", but only Geist is loaded via next/font
-- and the embed CSP (font-src 'self' data:) blocks an external fetch — the
-- option silently fell back to the system font. The zod enum no longer
-- accepts 'inter' (with a parse-time .catch('system') so unmigrated rows
-- keep their OTHER overrides); this migration rewrites the stored rows so
-- the column matches the schema again.

update public.shops
set widget_config = jsonb_set(widget_config, '{font_family}', '"system"')
where widget_config->>'font_family' = 'inter';
