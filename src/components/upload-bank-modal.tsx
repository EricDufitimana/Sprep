'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/trpc/client';
import { createClient } from '@/utils/supabase/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ProgressBar } from '@/components/ui/progress-bar';

interface UploadBankModalProps {
  open: boolean;
  onClose: () => void;
}

type Phase = 'form' | 'uploading' | 'parsing' | 'done';

/** Human label for the kind of file, from its extension. */
function fileKindLabel(name: string | undefined | null): string {
  if (!name) return 'file';
  if (/\.json$/i.test(name)) return 'JSON';
  if (/\.docx?$/i.test(name)) return 'Word file';
  if (/\.pdf$/i.test(name)) return 'PDF';
  return 'file';
}

/**
 * One file in, a bank out.
 *
 * The College Board "Answers" export already carries the correct answer and
 * rationale for every question, so there's nothing to cross-check against and
 * no second file to ask for. The server parses it deterministically.
 */
export function UploadBankModal({ open, onClose }: UploadBankModalProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>('form');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [result, setResult] = useState<{ verified: number; problems: string[] } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  const createFromPdf = useMutation(
    trpc.questionBanksManagement.createFromPdf.mutationOptions({
      onSuccess: async (res) => {
        setResult({ verified: res.verified, problems: res.problems });
        setPhase('done');
        await queryClient.invalidateQueries();
      },
      onError: (e) => {
        setError(e.message);
        setPhase('form');
      },
    }),
  );

  const reset = () => {
    setPhase('form');
    setName('');
    setFile(null);
    setError(null);
    setPct(0);
    setResult(null);
  };

  const close = () => {
    if (phase === 'uploading' || phase === 'parsing') return;
    reset();
    onClose();
  };

  const submit = async () => {
    setError(null);
    if (!file) return setError('Choose a PDF, Word, or JSON file.');

    const bankName = name.trim() || file.name.replace(/\.(pdf|docx?|json)$/i, '');

    setPhase('uploading');
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error('Your session expired. Sign in again.');

      // Path is namespaced by user id — that's what the bucket's RLS checks.
      // Keep the original extension so the server can tell PDF from Word from JSON.
      const path = `${uid}/${Date.now()}/${file.name.replace(/[^\w.-]/g, '_')}`;
      setPct(30);

      // Derive the content type from the extension so the server's kind
      // detection is right even when the browser leaves file.type blank.
      const byExt = /\.json$/i.test(file.name)
        ? 'application/json'
        : /\.docx$/i.test(file.name)
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : /\.pdf$/i.test(file.name)
            ? 'application/pdf'
            : '';
      const { error: upErr } = await supabase.storage
        .from('question-papers')
        .upload(path, file, { upsert: false, contentType: file.type || byExt || 'application/pdf' });

      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      setPct(100);
      setPhase('parsing');
      createFromPdf.mutate({ name: bankName, sourcePath: path });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
      setPhase('form');
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={phase === 'done' ? 'Bank created' : 'Create a test'}
      footer={
        phase === 'form' ? (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={submit}>
              <Icon name="cloud-upload" className="text-small" />
              Upload &amp; extract
            </Button>
          </>
        ) : phase === 'done' ? (
          <Button onClick={close}>Done</Button>
        ) : undefined
      }
    >
      {phase === 'form' && (
        <div className="space-y-4">
          <FilePick
            file={file}
            inputRef={fileRef}
            onPick={(f) => {
              setFile(f);
              if (f && !name.trim()) setName(f.name.replace(/\.(pdf|docx?|json)$/i, ''));
            }}
          />

          <Input
            label="Bank name"
            placeholder="e.g. Practice Test 4 — Reading & Writing"
            value={name}
            onChange={(e) => setName(e.target.value)}
            hint="Defaults to the file name."
          />

          <p className="rounded-control bg-blue-wash px-3 py-2 text-small text-ink-500">
            Upload a <strong className="font-medium text-ink-700">PDF, Word, or JSON</strong> file
            that includes each question’s options, the correct answer, and ideally an explanation. A
            College Board <strong className="font-medium text-ink-700">Answers</strong> export, a
            labelled practice set, and a structured JSON file all work — questions, options, answers,
            domains, and skills are read automatically.
          </p>

          {error && (
            <p role="alert" className="rounded-control bg-miss-tint px-3 py-2 text-small text-miss">
              {error}
            </p>
          )}
        </div>
      )}

      {(phase === 'uploading' || phase === 'parsing') && (
        <div className="space-y-3 py-4">
          <p className="text-body text-ink-700">
            {phase === 'uploading' ? `Uploading the ${fileKindLabel(file?.name)}…` : 'Reading the questions…'}
          </p>
          <ProgressBar value={phase === 'parsing' ? 100 : pct} label="Progress" />
          {phase === 'parsing' && (
            <p className="text-micro text-ink-400">
              Extracting each question, its options, correct answer, and rationale.
            </p>
          )}
        </div>
      )}

      {phase === 'done' && result && (
        <div className="space-y-4">
          <div className="rounded-control bg-green-tint px-4 py-4 text-center">
            <p className="text-h1 font-semibold text-ink-900 tabular-nums">{result.verified}</p>
            <p className="text-micro text-ink-700">questions ready to sit</p>
          </div>

          {result.problems.length > 0 ? (
            <div className="rounded-control bg-amber-tint px-3 py-2">
              <p className="text-small font-medium text-ink-900">
                {result.problems.length} block{result.problems.length === 1 ? '' : 's'} skipped
              </p>
              <ul className="mt-1 space-y-0.5">
                {result.problems.slice(0, 5).map((p) => (
                  <li key={p} className="text-micro text-ink-700">{p}</li>
                ))}
                {result.problems.length > 5 && (
                  <li className="text-micro text-ink-500">…and {result.problems.length - 5} more</li>
                )}
              </ul>
            </div>
          ) : (
            <p className="text-small text-ink-500">
              Every question in the file parsed cleanly.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function FilePick({
  file,
  inputRef,
  onPick,
}: {
  file: File | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (f: File | null) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const accepts = (f: File | undefined | null): f is File =>
    !!f && /\.(pdf|docx?|json)$/i.test(f.name);

  return (
    <div>
      <p className="mb-1.5 text-small font-medium text-ink-700">Question file</p>
      <button
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (accepts(dropped)) onPick(dropped);
        }}
        className={cn(
          'flex w-full items-center gap-3 rounded-control border border-dashed px-4 py-5 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue',
          dragging
            ? 'border-blue bg-blue-tint'
            : file
              ? 'border-blue/50 bg-blue-wash'
              : 'border-line hover:border-ink-400/50',
        )}
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface text-ink-500">
          <Icon name={file ? 'files' : 'cloud-upload'} className="text-base" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-ink-900">
            {file ? file.name : 'Choose a PDF, Word, or JSON file, or drop one here'}
          </span>
          <span className="block text-micro text-ink-400">
            {file ? `${(file.size / 1024).toFixed(0)} KB` : 'PDF, Word, or JSON (.pdf, .docx, .json)'}
          </span>
        </span>
      </button>
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="file"
        accept="application/pdf,.pdf,.doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.json,application/json"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </div>
  );
}
