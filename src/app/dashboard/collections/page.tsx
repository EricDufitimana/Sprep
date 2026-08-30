'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/utils';
import { domainLabel } from '@/lib/labels';
import { mathPreview } from '@/lib/math-preview';
import { UntimedTaker, type BuiltQuestion } from '@/components/untimed-taker';
import { FOLDER_SWATCH, FOLDER_COLOR_KEYS, type FolderColor } from '@/components/bookmark-modal';

/** A one-line readable preview of a question stem (math → text, tags stripped). */
function preview(text: string, section?: string | null): string {
  const base = section === 'math' ? mathPreview(text) : text;
  const clean = base
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > 160 ? clean.slice(0, 160) + '…' : clean;
}

/** null folderId = the "Unsorted" pseudo-folder. */
type Selected = { id: string | null; name: string; color: string };

export default function CollectionsPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const folders = useQuery(trpc.collections.listFolders.queryOptions());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [set, setSet] = useState<{ questions: BuiltQuestion[]; label: string; start: number } | null>(null);
  const [creating, setCreating] = useState(false);

  // The "do a set" surface takes over the whole view.
  if (set) {
    return (
      <UntimedTaker
        questions={set.questions}
        scopeLabel={set.label}
        startIndex={set.start}
        onExit={() => setSet(null)}
      />
    );
  }

  if (selected) {
    return (
      <FolderView
        folder={selected}
        onBack={() => setSelected(null)}
        onStartSet={(questions, start) =>
          setSet({ questions, label: `Collection · ${selected.name}`, start })
        }
      />
    );
  }

  const data = folders.data;
  const cards: Selected[] = [
    ...(data?.folders ?? []).map((f) => ({ id: f.id, name: f.name, color: f.color })),
  ];

  return (
    <>
      <PageHeader
        title="Collections"
        description="Questions you’ve bookmarked, organized into folders. Open a folder to review or re-do it as a set."
      >
        <Button onClick={() => setCreating(true)}>
          <Icon name="plus" className="text-small" />
          New folder
        </Button>
      </PageHeader>

      {folders.isLoading ? (
        <p className="mt-10 text-center text-body text-ink-400">Loading your collections…</p>
      ) : (data?.totalBookmarks ?? 0) === 0 && (data?.folders.length ?? 0) === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((f) => (
            <FolderCard
              key={f.id ?? 'unsorted'}
              folder={f}
              count={data?.folders.find((x) => x.id === f.id)?.count ?? 0}
              onOpen={() => setSelected(f)}
            />
          ))}
          {(data?.unsortedCount ?? 0) > 0 && (
            <FolderCard
              folder={{ id: null, name: 'Unsorted', color: 'slate' }}
              count={data?.unsortedCount ?? 0}
              onOpen={() => setSelected({ id: null, name: 'Unsorted', color: 'slate' })}
            />
          )}
        </div>
      )}

      <CreateFolderModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => queryClient.invalidateQueries(trpc.collections.listFolders.queryFilter())}
      />
    </>
  );
}

/* ─────────────────────────────── folder grid card ─────────────────────────── */

function FolderCard({
  folder,
  count,
  onOpen,
}: {
  folder: Selected;
  count: number;
  onOpen: () => void;
}) {
  const sw = FOLDER_SWATCH[folder.color] ?? FOLDER_SWATCH.slate;
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface text-left transition-shadow hover:shadow-[0_6px_20px_rgba(0,0,0,0.07)]"
    >
      <div className={cn('h-2', sw.dot)} />
      <div className="flex items-start gap-3 px-5 py-4">
        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', sw.soft)}>
          <Icon name={folder.id === null ? 'bookmark' : 'folder'} className={cn('text-lead', sw.text)} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lead font-semibold text-ink-900">{folder.name}</p>
          <p className="mt-0.5 text-small text-ink-400">
            {count} question{count === 1 ? '' : 's'}
          </p>
        </div>
        <Icon name="chevron-right" className="mt-1 text-small text-ink-300 transition-transform group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-tint">
        <Icon name="bookmark" className="text-h2 text-blue" />
      </span>
      <p className="mt-4 text-lead font-semibold text-ink-900">No bookmarks yet</p>
      <p className="mt-1 max-w-sm text-body text-ink-500">
        While practicing, open a question’s <strong className="font-medium text-ink-700">More</strong> menu and choose
        <strong className="font-medium text-ink-700"> Save to collection</strong> to start building folders here.
      </p>
      <Button className="mt-5" onClick={onCreate}>
        <Icon name="plus" className="text-small" />
        Create a folder
      </Button>
    </div>
  );
}

/* ─────────────────────────────── folder detail ────────────────────────────── */

function FolderView({
  folder,
  onBack,
  onStartSet,
}: {
  folder: Selected;
  onBack: () => void;
  onStartSet: (questions: BuiltQuestion[], start: number) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);

  const q = useQuery(trpc.collections.folderQuestions.queryOptions({ folderId: folder.id }));
  const questions = useMemo(() => (q.data?.questions ?? []) as unknown as BuiltQuestion[], [q.data]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries(trpc.collections.folderQuestions.queryFilter({ folderId: folder.id })),
      queryClient.invalidateQueries(trpc.collections.listFolders.queryFilter()),
    ]);

  const removeBookmark = useMutation(trpc.collections.removeBookmark.mutationOptions({ onSuccess: refresh }));
  const deleteFolder = useMutation(
    trpc.collections.deleteFolder.mutationOptions({
      onSuccess: async () => {
        await refresh();
        onBack();
      },
    }),
  );

  const sw = FOLDER_SWATCH[folder.color] ?? FOLDER_SWATCH.slate;

  return (
    <>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-small font-medium text-ink-500 hover:text-ink-800">
        <Icon name="arrow-left" className="text-small" />
        All collections
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <span className={cn('flex h-12 w-12 items-center justify-center rounded-xl', sw.soft)}>
          <Icon name={folder.id === null ? 'bookmark' : 'folder'} className={cn('text-h3', sw.text)} />
        </span>
        <div className="mr-auto">
          <h1 className="text-h2 font-semibold text-ink-900">{folder.name}</h1>
          <p className="text-small text-ink-400">
            {questions.length} question{questions.length === 1 ? '' : 's'}
          </p>
        </div>
        {questions.length > 0 && (
          <Button onClick={() => onStartSet(questions, 0)}>
            <Icon name="bolt" className="text-small" />
            Do a set
          </Button>
        )}
        {folder.id !== null && (
          <>
            <Button variant="ghost" onClick={() => setRenaming(true)} aria-label="Rename folder">
              <Icon name="pencil" className="text-small" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm(`Delete “${folder.name}”? Its questions move to Unsorted.`)) {
                  deleteFolder.mutate({ id: folder.id as string });
                }
              }}
              aria-label="Delete folder"
            >
              <Icon name="trash-can" className="text-small text-miss" />
            </Button>
          </>
        )}
      </div>

      {q.isLoading ? (
        <p className="mt-10 text-center text-body text-ink-400">Loading…</p>
      ) : questions.length === 0 ? (
        <p className="mt-10 rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center text-body text-ink-500">
          This folder is empty. Save questions to it from the practice screen’s <strong className="font-medium">More → Save to collection</strong>.
        </p>
      ) : (
        <ol className="mt-6 space-y-2">
          {questions.map((question, i) => (
            <li key={question.id}>
              <div className="group flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                <button
                  onClick={() => onStartSet(questions, i)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-tint text-small font-semibold text-blue">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-body text-ink-800">
                      {preview(question.question_text, question.section)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-micro text-ink-400">
                      {question.domain && <span>{domainLabel(question.domain)}</span>}
                      {question.skill && <span>· {question.skill}</span>}
                      {question.difficulty && <span className="capitalize">· {question.difficulty}</span>}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => removeBookmark.mutate({ questionId: question.id, folderId: folder.id })}
                  aria-label="Remove from folder"
                  className="rounded-md p-1 text-ink-300 opacity-0 transition-opacity hover:text-miss group-hover:opacity-100"
                >
                  <Icon name="close" className="text-small" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {folder.id !== null && (
        <RenameFolderModal
          open={renaming}
          onClose={() => setRenaming(false)}
          folder={folder}
          onSaved={refresh}
        />
      )}
    </>
  );
}

/* ─────────────────────────────── create / rename ──────────────────────────── */

function ColorPicker({ value, onChange }: { value: FolderColor; onChange: (c: FolderColor) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {FOLDER_COLOR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={c}
          className={cn('h-7 w-7 rounded-full', FOLDER_SWATCH[c].dot, value === c ? 'ring-2 ring-offset-2 ring-ink-400' : '')}
        />
      ))}
    </div>
  );
}

function CreateFolderModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const trpc = useTRPC();
  const [name, setName] = useState('');
  const [color, setColor] = useState<FolderColor>('blue');
  const create = useMutation(
    trpc.collections.createFolder.mutationOptions({
      onSuccess: () => {
        onCreated();
        setName('');
        setColor('blue');
        onClose();
      },
    }),
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New folder"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => name.trim() && create.mutate({ name: name.trim(), color })} disabled={!name.trim() || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create folder'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Folder name"
          placeholder="e.g. Tricky transitions"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Color</p>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>
    </Modal>
  );
}

function RenameFolderModal({
  open,
  onClose,
  folder,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  folder: Selected;
  onSaved: () => void;
}) {
  const trpc = useTRPC();
  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState<FolderColor>(folder.color as FolderColor);
  const rename = useMutation(
    trpc.collections.renameFolder.mutationOptions({
      onSuccess: () => {
        onSaved();
        onClose();
      },
    }),
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit folder"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => name.trim() && rename.mutate({ id: folder.id as string, name: name.trim(), color })}
            disabled={!name.trim() || rename.isPending}
          >
            {rename.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Folder name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div>
          <p className="mb-1.5 text-small font-medium text-ink-700">Color</p>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>
    </Modal>
  );
}
