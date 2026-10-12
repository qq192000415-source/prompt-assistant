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

-- 文档库文件：私有 bucket，路径为 <user_id>/<sha256>，每个用户只能读写自己目录下的文件。
insert into storage.buckets (id, name, public, file_size_limit)
values ('prompt-attachments', 'prompt-attachments', false, 52428800)
on conflict (id) do nothing;

drop policy if exists prompt_attachments_select_own on storage.objects;
drop policy if exists prompt_attachments_insert_own on storage.objects;
drop policy if exists prompt_attachments_delete_own on storage.objects;

create policy prompt_attachments_select_own
on storage.objects
for select
to authenticated
using (bucket_id = 'prompt-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy prompt_attachments_insert_own
on storage.objects
for insert
to authenticated
with check (bucket_id = 'prompt-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

create policy prompt_attachments_delete_own
on storage.objects
for delete
to authenticated
using (bucket_id = 'prompt-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
