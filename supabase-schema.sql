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

-- 授权管理的用户列表和备注（1.9.8）：管理员在设置里看到所有注册过的账号、是否已授权，并能写备注（姓名等）和标签。
-- 备注单独一张表，收回授权后备注还在。只有管理员能读写。
create table if not exists public.app_user_notes (
  email text primary key check (email = lower(email)),
  note text not null default '',
  tags text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.app_user_notes enable row level security;
alter table public.app_user_notes force row level security;
revoke all on table public.app_user_notes from anon;
grant select, insert, update, delete on table public.app_user_notes to authenticated;

drop policy if exists app_user_notes_admin_all on public.app_user_notes;

create policy app_user_notes_admin_all
on public.app_user_notes
for all
to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

-- 推荐 API 地址（1.14.1）：管理员按账号单独填（和 NAS 授权无关，没授权 NAS 的账号也能填），对方登录后软件提示把 API 配置里的接口地址换成它（Key 不变）。
-- 本人只读得到自己那一行，只有管理员能增删改。1.14.0 曾把它放在 nas_grants.api_base_url（所有授权共用一个），已删掉。
create table if not exists public.api_recommendations (
  email text primary key check (email = lower(email)),
  api_base_url text not null,
  updated_at timestamptz not null default now()
);

alter table public.nas_grants drop column if exists api_base_url;

alter table public.api_recommendations enable row level security;
alter table public.api_recommendations force row level security;
revoke all on table public.api_recommendations from anon;
grant select, insert, update, delete on table public.api_recommendations to authenticated;

drop policy if exists api_recommendations_select on public.api_recommendations;
drop policy if exists api_recommendations_admin_write on public.api_recommendations;

create policy api_recommendations_select
on public.api_recommendations
for select
to authenticated
using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_app_admin());

create policy api_recommendations_admin_write
on public.api_recommendations
for all
to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

-- 账号密码（1.17.1，主人定的）：管理员能看到、修改、重置客户在灵匣的密码。Supabase 只存密码的加密指纹（还原不出来），
-- 所以密码被设置的时候（登录、注册、自己改密码、管理员重置）另存一份明文到这张表，只有管理员能读；这个版本之前设的密码看不到，
-- 客户用新版登录一次后就有了。注册、登录框和改密码处都提示「管理员能看到你的灵匣密码，别用其他网站的密码」。
create table if not exists public.account_passwords (
  email text primary key check (email = lower(email)),
  password text not null,
  updated_at timestamptz not null default now()
);

alter table public.account_passwords enable row level security;
alter table public.account_passwords force row level security;
revoke all on table public.account_passwords from anon;
revoke all on table public.account_passwords from authenticated;
grant select on table public.account_passwords to authenticated;

drop policy if exists account_passwords_admin_select on public.account_passwords;

create policy account_passwords_admin_select
on public.account_passwords
for select
to authenticated
using (public.is_app_admin());

-- 本人记下自己刚设好的密码：只能写自己邮箱那一行，读不到这张表。登录、注册成功和自己改密码后由软件调用。
create or replace function public.record_own_password(new_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  own text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if own = '' then
    raise exception '没有登录';
  end if;
  if length(new_password) < 6 or octet_length(new_password) > 72 then
    raise exception '密码要 6 位以上';
  end if;
  insert into public.account_passwords (email, password, updated_at)
  values (own, new_password, now())
  on conflict (email) do update set password = excluded.password, updated_at = now();
end;
$$;

revoke all on function public.record_own_password(text) from public;
grant execute on function public.record_own_password(text) to authenticated;

-- 管理员重置别人的密码：直接改 auth.users 里的加密指纹（bcrypt，和 Supabase 自己存的格式一样），
-- 删掉这个账号的全部登录会话（其他电脑上的登录在令牌过期后要重新登录），并记下新密码。
create or replace function public.admin_set_password(target_email text, new_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  target text := lower(trim(coalesce(target_email, '')));
  uid uuid;
begin
  if not public.is_app_admin() then
    raise exception '只有管理员能修改别人的密码';
  end if;
  if length(new_password) < 6 or octet_length(new_password) > 72 then
    raise exception '密码要 6 位以上';
  end if;
  select id into uid from auth.users where lower(email) = target order by created_at limit 1;
  if uid is null then
    raise exception '这个邮箱还没注册，没有密码可改';
  end if;
  update auth.users set encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')), updated_at = now() where id = uid;
  delete from auth.sessions where user_id = uid;
  insert into public.account_passwords (email, password, updated_at)
  values (target, new_password, now())
  on conflict (email) do update set password = excluded.password, updated_at = now();
end;
$$;

revoke all on function public.admin_set_password(text, text) from public;
grant execute on function public.admin_set_password(text, text) to authenticated;

-- 注册账号在 auth.users 里，普通请求读不到；这个函数只给管理员用，列出所有账号（加上已授权但还没注册的邮箱）。
-- 1.14.1 起多返回 api_base_url（推荐 API 地址），1.17.1 起多返回 password（记下的灵匣密码，没有是空），返回列变了要先删掉旧函数。
drop function if exists public.list_app_users();

create function public.list_app_users()
returns table (email text, registered_at timestamptz, last_sign_in_at timestamptz, granted boolean, granted_at timestamptz, note text, tags text[], api_base_url text, password text)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_app_admin() then
    raise exception '只有管理员能查看用户列表';
  end if;
  return query
  with users as (
    select lower(u.email)::text as email, min(u.created_at) as registered_at, max(u.last_sign_in_at) as last_sign_in_at
    from auth.users u
    where u.email is not null
    group by lower(u.email)
  ),
  emails as (
    select users.email from users
    union
    select nas_grants.email from public.nas_grants
  )
  select e.email, u.registered_at, u.last_sign_in_at, g.email is not null, g.updated_at, coalesce(n.note, ''), coalesce(n.tags, '{}'::text[]), coalesce(r.api_base_url, ''), coalesce(pw.password, '')
  from emails e
  left join users u on u.email = e.email
  left join public.nas_grants g on g.email = e.email
  left join public.app_user_notes n on n.email = e.email
  left join public.api_recommendations r on r.email = e.email
  left join public.account_passwords pw on pw.email = e.email
  order by u.registered_at desc nulls last, e.email;
end;
$$;

revoke all on function public.list_app_users() from public;
grant execute on function public.list_app_users() to authenticated;

-- AI 功能规则（1.17.0）：管理员对素材库 AI 功能（反推、优化、翻译、分类等）规则的改动，一个功能一行，rules 是条目数组
-- （id 同内置规则的是修改或隐藏，其余是新增，格式见 electron/materials/aiRules.ts）。登录的账号都能读，只有管理员能增删改。
create table if not exists public.ai_rule_overrides (
  action text primary key,
  rules jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ai_rule_overrides enable row level security;
alter table public.ai_rule_overrides force row level security;
revoke all on table public.ai_rule_overrides from anon;
grant select, insert, update, delete on table public.ai_rule_overrides to authenticated;

drop policy if exists ai_rule_overrides_select on public.ai_rule_overrides;
drop policy if exists ai_rule_overrides_admin_write on public.ai_rule_overrides;

create policy ai_rule_overrides_select
on public.ai_rule_overrides
for select
to authenticated
using (true);

create policy ai_rule_overrides_admin_write
on public.ai_rule_overrides
for all
to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

-- 来图定制授权（1.18.0）：一个邮箱一行，有这一行才显示「定制」标签。team 是公司（同一团队共用产品模板和订单），
-- base_url / username / password 是定制专用 NAS 文件夹的连接（和素材库的 NAS 授权分开）。本人只能读自己那行，只有管理员能增删改。
create table if not exists public.custom_teams (
  email text primary key check (email = lower(email)),
  team text not null check (length(trim(team)) > 0),
  base_url text not null,
  username text not null,
  password text not null,
  updated_at timestamptz not null default now()
);

alter table public.custom_teams enable row level security;
alter table public.custom_teams force row level security;
revoke all on table public.custom_teams from anon;
grant select, insert, update, delete on table public.custom_teams to authenticated;

drop policy if exists custom_teams_select on public.custom_teams;
drop policy if exists custom_teams_admin_write on public.custom_teams;

create policy custom_teams_select
on public.custom_teams
for select
to authenticated
using (email = lower(coalesce(auth.jwt() ->> 'email', '')) or public.is_app_admin());

create policy custom_teams_admin_write
on public.custom_teams
for all
to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());
