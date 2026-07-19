create table public.creators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.posts (
  id text primary key,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null check (status in ('draft', 'published')),
  title text not null,
  subtitle text not null default '',
  category text not null default '',
  collection_name text not null default '',
  author text not null default '',
  published_date date not null,
  published_time time,
  place text not null default '',
  reading_minutes integer not null default 1,
  accent text not null default '#111111',
  cover_tone text not null default 'ink',
  image_url text not null default '',
  links jsonb not null default '[]'::jsonb,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_creator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.creators where user_id = auth.uid());
$$;

alter table public.creators enable row level security;
alter table public.posts enable row level security;

create policy "creator reads own membership"
on public.creators
for select
to authenticated
using (auth.uid() = user_id);

create policy "published posts are public"
on public.posts
for select
to anon, authenticated
using (status = 'published' or public.is_creator());

create policy "creator inserts posts"
on public.posts
for insert
to authenticated
with check (public.is_creator());

create policy "creator updates posts"
on public.posts
for update
to authenticated
using (public.is_creator())
with check (public.is_creator());

create policy "creator deletes posts"
on public.posts
for delete
to authenticated
using (public.is_creator());

grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;
grant execute on function public.is_creator() to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do update set public = true;

create policy "creator uploads covers"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'covers' and public.is_creator());

create policy "creator updates covers"
on storage.objects
for update
to authenticated
using (bucket_id = 'covers' and public.is_creator())
with check (bucket_id = 'covers' and public.is_creator());

create policy "creator deletes covers"
on storage.objects
for delete
to authenticated
using (bucket_id = 'covers' and public.is_creator());
