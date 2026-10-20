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

-- 素材库 NAS 授权（1.9.7）：管理员给某个账号开通 NAS 连接，对方登录后自动连上。
-- 管理员名单在 app_admins 里：执行完这段后，再手动执行一次
--   insert into public.app_admins (email) values ('你的管理员邮箱（小写）') on conflict do nothing;
-- 仓库里不写真实邮箱。普通用户读不到 app_admins，只能通过 is_app_admin() 知道自己是不是管理员。
create table if not exists public.app_admins (
  email text primary key check (email = lower(email))
);

alter table public.app_admins enable row level security;
alter table public.app_admins force row level security;
revoke all on table public.app_admins from anon, authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

-- 一个账号一行：NAS 地址、用户名、密码。被授权的人只读得到自己那一行（软件要用密码连 NAS，所以拿到的是真密码），
-- 只有管理员能增删改。收回授权 = 删掉这一行，对方下次启动或登录时断开。
create table if not exists public.nas_grants (
  email text primary key check (email = lower(email)),
  base_url text not null,
  username text not null,
  password text not null,
  updated_at timestamptz not null default now()
);

alter table public.nas_grants enable row level security;
alter table public.nas_grants force row level security;
revoke all on table public.nas_grants from anon;
grant select, insert, update, delete on table public.nas_grants to authenticated;

drop policy if exists nas_grants_select on public.nas_grants;
drop policy if exists nas_grants_admin_insert on public.nas_grants;
drop policy if exists nas_grants_admin_update on public.nas_grants;
drop policy if exists nas_grants_admin_delete on public.nas_grants;

create policy nas_grants_select
on public.nas_grants
for select
to authenticated
using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_app_admin());

create policy nas_grants_admin_insert
on public.nas_grants
for insert
to authenticated
with check (public.is_app_admin());

create policy nas_grants_admin_update
on public.nas_grants
for update
to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

create policy nas_grants_admin_delete
on public.nas_grants
for delete
to authenticated
using (public.is_app_admin());
