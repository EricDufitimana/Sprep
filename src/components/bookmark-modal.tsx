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
  // Row key + direction just toggled, so we can flash a subtle confirmation
  // ("Added" on save, a quick tint on remove) immediately on click.
  const [flash, setFlash] = useState<{ key: string; mode: 'add' | 'remove' } | null>(null);

  const folders = useQuery(trpc.collections.listFolders.queryOptions());
  const state = useQuery(trpc.collections.questionState.queryOptions({ questionId }));

  const stateKey = trpc.collections.questionState.queryOptions({ questionId }).queryKey;
  const foldersKey = trpc.collections.listFolders.queryOptions().queryKey;

  type StateData = { folderIds: string[]; unsorted: boolean; bookmarked: boolean };
  type FoldersData = {
    folders: { id: string; name: string; color: string; createdAt: string; count: number }[];
    unsortedCount: number;
    totalBookmarks: number;
  };

  /** Immediately reflect an add/remove in both caches so the check + counts update
   *  with no wait on the network. onSettled reconciles with the server after. */
  const applyOptimistic = (folderId: string | null, adding: boolean) => {
    queryClient.setQueryData<StateData>(stateKey, (prev) => {
      const base: StateData = prev ?? { folderIds: [], unsorted: false, bookmarked: false };
      const folderIds =
        folderId === null
          ? base.folderIds
          : adding
            ? base.folderIds.includes(folderId)
              ? base.folderIds
              : [...base.folderIds, folderId]
            : base.folderIds.filter((id) => id !== folderId);
      const unsorted = folderId === null ? adding : base.unsorted;
      return { folderIds, unsorted, bookmarked: folderIds.length > 0 || unsorted };
    });
    queryClient.setQueryData<FoldersData>(foldersKey, (prev) => {
      if (!prev) return prev;
      const delta = adding ? 1 : -1;
      return {
        ...prev,
        unsortedCount: folderId === null ? Math.max(0, prev.unsortedCount + delta) : prev.unsortedCount,
        totalBookmarks: Math.max(0, prev.totalBookmarks + delta),
        folders: prev.folders.map((f) =>
          f.id === folderId ? { ...f, count: Math.max(0, f.count + delta) } : f,
        ),
      };
    });
  };

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.collections.listFolders.queryFilter()),
      queryClient.invalidateQueries(trpc.collections.questionState.queryFilter({ questionId })),
    ]);
  };

  const bookmark = useMutation(trpc.collections.bookmark.mutationOptions({ onSettled: refresh }));
  const removeBookmark = useMutation(trpc.collections.removeBookmark.mutationOptions({ onSettled: refresh }));
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

  const rowKey = (folderId: string | null) => folderId ?? 'unsorted';

  const toggle = (folderId: string | null) => {
    const adding = !inFolder(folderId);
    // Update caches first so the checkmark + counts change on this very frame.
    applyOptimistic(folderId, adding);
    if (adding) bookmark.mutate({ questionId, folderId });
    else removeBookmark.mutate({ questionId, folderId });
    // Subtle immediate confirmation, cleared shortly after.
    const key = rowKey(folderId);
    const mode = adding ? 'add' : 'remove';
    setFlash({ key, mode });
    window.setTimeout(() => setFlash((cur) => (cur?.key === key ? null : cur)), 1200);
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
            const flashing = flash?.key === rowKey(row.id);
            const justAdded = flashing && flash?.mode === 'add';
            const justRemoved = flashing && flash?.mode === 'remove';
            const active = inFolder(row.id);
            const sw = FOLDER_SWATCH[row.color] ?? FOLDER_SWATCH.slate;
            return (
              <button
                key={row.id ?? 'unsorted'}
                onClick={() => toggle(row.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-control px-2.5 py-2 text-left transition-colors duration-300',
                  justAdded ? sw.soft : 'hover:bg-surface',
                )}
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
                {justAdded && (
                  <span className="text-micro font-medium text-blue duration-300 animate-in fade-in slide-in-from-right-1">
                    Added
                  </span>
                )}
                {justRemoved && (
                  <span className="text-micro font-medium text-ink-400 duration-300 animate-in fade-in slide-in-from-right-1">
                    Removed
                  </span>
                )}
                <span
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-[6px] border transition-transform duration-200',
                    active ? 'border-blue bg-blue text-white' : 'border-line text-transparent',
                    justAdded && 'scale-110',
                    justRemoved && 'scale-90',
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
