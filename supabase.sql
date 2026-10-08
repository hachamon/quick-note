-- À coller dans Supabase : SQL Editor → New query → Run.
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  text text not null,
  kind text not null default 'idea' check (kind in ('idea', 'task')),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notes_user_created on public.notes (user_id, created_at desc);

-- Chaque utilisateur ne voit et ne modifie que ses propres notes.
alter table public.notes enable row level security;

drop policy if exists "own notes" on public.notes;
create policy "own notes" on public.notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Synchronisation en direct entre téléphone et Mac.
alter publication supabase_realtime add table public.notes;
