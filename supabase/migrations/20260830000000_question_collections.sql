-- Bookmarked-question collections: a user can save any question into named,
-- colored folders and later re-do a folder as an untimed set.
--
--   question_folders   — the user's folders (name + color for the grid).
--   question_bookmarks — a saved question, optionally filed under a folder
--                        (folder_id null = "Unsorted"). A question may live in
--                        several folders (one row each).

create table public.question_folders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text not null,
  -- A palette key ("blue", "rose", …) the collections grid maps to a swatch.
  color      text not null default 'blue',
  created_at timestamptz not null default now()
);

create index idx_question_folders_user on public.question_folders (user_id, created_at desc);

alter table public.question_folders enable row level security;

create policy "question_folders_select_own" on public.question_folders for select using (auth.uid() = user_id);
create policy "question_folders_insert_own" on public.question_folders for insert with check (auth.uid() = user_id);
create policy "question_folders_update_own" on public.question_folders for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "question_folders_delete_own" on public.question_folders for delete using (auth.uid() = user_id);

create table public.question_bookmarks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  -- Null = the question is bookmarked but not filed under any folder ("Unsorted").
  -- Deleting a folder drops its questions back to Unsorted rather than losing them.
  folder_id   uuid references public.question_folders (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index idx_question_bookmarks_user on public.question_bookmarks (user_id, created_at desc);
create index idx_question_bookmarks_folder on public.question_bookmarks (folder_id);
create index idx_question_bookmarks_question on public.question_bookmarks (user_id, question_id);

-- One bookmark per (user, question) within a folder, and one Unsorted bookmark
-- per (user, question). Split in two because NULLs are distinct in a plain
-- unique constraint (so the Unsorted case needs its own partial index).
create unique index uniq_bookmark_in_folder
  on public.question_bookmarks (user_id, question_id, folder_id)
  where folder_id is not null;
create unique index uniq_bookmark_unsorted
  on public.question_bookmarks (user_id, question_id)
  where folder_id is null;

alter table public.question_bookmarks enable row level security;

create policy "question_bookmarks_select_own" on public.question_bookmarks for select using (auth.uid() = user_id);
create policy "question_bookmarks_insert_own" on public.question_bookmarks for insert with check (auth.uid() = user_id);
create policy "question_bookmarks_update_own" on public.question_bookmarks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "question_bookmarks_delete_own" on public.question_bookmarks for delete using (auth.uid() = user_id);
