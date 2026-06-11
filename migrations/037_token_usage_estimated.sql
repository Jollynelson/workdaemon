-- 037_token_usage_estimated.sql — mark whether a row's counts came from the
-- provider's reported usage (exact) or a chars/4 fallback (estimated). Lets the
-- Overview widget show an honest note only when estimates are present.
alter table public.token_usage add column if not exists estimated boolean not null default false;
