'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import { Modal } from '@/components/ui/modal';

/** Folder palette keys — must match the server's FOLDER_COLORS enum. */
export type FolderColor = 'blue' | 'rose' | 'green' | 'amber' | 'violet' | 'cyan' | 'slate';

/** Folder palette — keys match the server's FOLDER_COLORS; values are swatch classes.
 *  Typed by `string` key so a stray/legacy color still indexes (with a fallback). */
export const FOLDER_SWATCH: Record<string, { dot: string; soft: string; text: string }> = {
  blue: { dot: 'bg-[#3B5BDB]', soft: 'bg-[#EEF2FF]', text: 'text-[#3B5BDB]' },
  rose: { dot: 'bg-[#E64980]', soft: 'bg-[#FFF0F6]', text: 'text-[#C2255C]' },
  green: { dot: 'bg-[#2F9E44]', soft: 'bg-[#EBFBEE]', text: 'text-[#2B8A3E]' },
  amber: { dot: 'bg-[#F08C00]', soft: 'bg-[#FFF9DB]', text: 'text-[#E67700]' },
  violet: { dot: 'bg-[#7048E8]', soft: 'bg-[#F3F0FF]', text: 'text-[#6741D9]' },
  cyan: { dot: 'bg-[#1098AD]', soft: 'bg-[#E3FAFC]', text: 'text-[#0C8599]' },
  slate: { dot: 'bg-[#495057]', soft: 'bg-[#F1F3F5]', text: 'text-[#343A40]' },
};
export const FOLDER_COLOR_KEYS: FolderColor[] = ['blue', 'rose', 'green', 'amber', 'violet', 'cyan', 'slate'];

/**
 * Bookmark a question into folders (or "Unsorted"). Shows every folder with a
 * checkbox for whether this question is in it, and lets the user spin up a new
 * folder inline. Each toggle writes immediately and refreshes the collections
 * views, so the modal always reflects the true saved state.
 */
export function BookmarkModal({
  open,
  onClose,
  questionId,
}: {
  open: boolean;
  onClose: () => void;
  questionId: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<FolderColor>('blue');
  const [creating, setCreating] = useState(false);

  const folders = useQuery(trpc.collections.listFolders.queryOptions());
  const state = useQuery(trpc.collections.questionState.queryOptions({ questionId }));

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.collections.listFolders.queryFilter()),
      queryClient.invalidateQueries(trpc.collections.questionState.queryFilter({ questionId })),
    ]);
  };

  const bookmark = useMutation(trpc.collections.bookmark.mutationOptions({ onSuccess: refresh }));
  const removeBookmark = useMutation(trpc.collections.removeBookmark.mutationOptions({ onSuccess: refresh }));
  const createFolder = useMutation(
    trpc.collections.createFolder.mutationOptions({
      onSuccess: async (folder) => {
        // A new folder is created to hold this question, so file it in there.
        await bookmark.mutateAsync({ questionId, folderId: folder.id });
        setNewName('');
        setCreating(false);
        await refresh();
      },
    }),
  );

  const inFolder = (folderId: string | null) =>
    folderId === null ? Boolean(state.data?.unsorted) : (state.data?.folderIds ?? []).includes(folderId);

  const toggle = (folderId: string | null) => {
    if (inFolder(folderId)) removeBookmark.mutate({ questionId, folderId });
    else bookmark.mutate({ questionId, folderId });
  };

  const rows: { id: string | null; name: string; color: string; count?: number }[] = [
    { id: null, name: 'Unsorted', color: 'slate', count: folders.data?.unsortedCount },
    ...(folders.data?.folders ?? []).map((f) => ({ id: f.id, name: f.name, color: f.color, count: f.count })),
  ];

  return (
    <Modal open={open} onClose={onClose} title="Save to collection">
      <div className="space-y-1">
        {folders.isLoading ? (
          <p className="py-6 text-center text-small text-ink-400">Loading your folders…</p>
        ) : (
          rows.map((row) => {
            const active = inFolder(row.id);
            const sw = FOLDER_SWATCH[row.color] ?? FOLDER_SWATCH.slate;
            return (
              <button
                key={row.id ?? 'unsorted'}
                onClick={() => toggle(row.id)}
                className="flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left hover:bg-surface"
              >
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', sw.soft)}>
                  <Icon name={row.id === null ? 'bookmark' : 'folder'} className={cn('text-small', sw.text)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink-900">{row.name}</span>
                  {typeof row.count === 'number' && (
                    <span className="block text-micro text-ink-400">
                      {row.count} question{row.count === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-[6px] border',
                    active ? 'border-blue bg-blue text-white' : 'border-line text-transparent',
                  )}
                >
                  <Icon name="checkmark" className="text-[10px]" />
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        {creating ? (
          <div className="space-y-2.5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newName.trim()) createFolder.mutate({ name: newName.trim(), color: newColor });
                if (e.key === 'Escape') setCreating(false);
              }}
              placeholder="Folder name"
              maxLength={60}
              className="w-full rounded-control border border-line px-3 py-2 text-body outline-none focus:border-blue"
            />
            <div className="flex items-center gap-1.5">
              {FOLDER_COLOR_KEYS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  aria-label={c}
                  className={cn(
                    'h-6 w-6 rounded-full',
                    FOLDER_SWATCH[c].dot,
                    newColor === c ? 'ring-2 ring-offset-2 ring-ink-400' : '',
                  )}
                />
              ))}
              <div className="ml-auto flex gap-2">
                <button
                  onClick={() => setCreating(false)}
                  className="rounded-full px-3 py-1.5 text-small font-medium text-ink-500 hover:text-ink-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => newName.trim() && createFolder.mutate({ name: newName.trim(), color: newColor })}
                  disabled={!newName.trim() || createFolder.isPending}
                  className="rounded-full bg-blue px-4 py-1.5 text-small font-semibold text-white disabled:opacity-40"
                >
                  {createFolder.isPending ? 'Creating…' : 'Create & save'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-body text-blue hover:bg-blue-wash"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-tint">
              <Icon name="plus" className="text-small" />
            </span>
            New folder
          </button>
        )}
      </div>
    </Modal>
  );
}
