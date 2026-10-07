create table if not exists public.prompt_libraries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prompts jsonb not null default '[]'::jsonb,
  categories jsonb not null default '[]'::jsonb,
  subcategories jsonb not null default '{}'::jsonb,
  deleted_records jsonb not null default '[]'::jsonb,
  sync_records jsonb not null default '[]'::jsonb,
  export_settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.prompt_libraries enable row level security;
alter table public.prompt_libraries force row level security;

grant usage on schema public to anon, authenticated;
grant select on table public.prompt_libraries to anon;
grant select, insert, update, delete on table public.prompt_libraries to authenticated;

drop policy if exists prompt_libraries_select_own on public.prompt_libraries;
drop policy if exists prompt_libraries_insert_own on public.prompt_libraries;
drop policy if exists prompt_libraries_update_own on public.prompt_libraries;
drop policy if exists prompt_libraries_delete_own on public.prompt_libraries;

create policy prompt_libraries_select_own
on public.prompt_libraries
for select
using (auth.uid() = user_id);

create policy prompt_libraries_insert_own
on public.prompt_libraries
for insert
with check (auth.uid() = user_id);

create policy prompt_libraries_update_own
on public.prompt_libraries
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy prompt_libraries_delete_own
on public.prompt_libraries
for delete
using (auth.uid() = user_id);
