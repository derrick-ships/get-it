"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Upload,
  Loader2,
  ArrowRight,
  Box,
  Activity,
  Atom,
  FileText,
  FlaskConical,
  HeartPulse,
  Scale,
  Sigma,
  BarChart3,
  SquareFunction,
  Network,
  BookOpen,
  AlertTriangle,
  X,
} from "lucide-react";

type FeatureColor = "rose" | "amber" | "emerald" | "violet" | "sky";
type FeatureIcon = React.ComponentType<{
  className?: string;
  style?: React.CSSProperties;
  "aria-hidden"?: boolean;
}>;
type SampleIcon = {
  Icon: FeatureIcon;
  tone: FeatureColor;
  label: string;
};

const SAMPLE_ICONS: Record<string, SampleIcon> = {
  anatomy: { Icon: HeartPulse, tone: "rose", label: "Anatomy" },
  physics: { Icon: Atom, tone: "amber", label: "Physics" },
  costituzione: { Icon: Scale, tone: "emerald", label: "Constitution" },
  calculus: { Icon: SquareFunction, tone: "violet", label: "Calculus" },
  chemistry: { Icon: FlaskConical, tone: "sky", label: "Chemistry" },
};
const DEFAULT_SAMPLE_ICON: SampleIcon = { Icon: FileText, tone: "emerald", label: "Document" };

const FEATURES: Array<{
  color: FeatureColor;
  icon: FeatureIcon;
  title: string;
  desc: string;
}> = [
  { color: "rose",   icon: Box,       title: "3D models",   desc: "Rotate molecules, organs, geometries" },
  { color: "amber",  icon: Activity,  title: "Simulations", desc: "Watch concepts come alive" },
  { color: "violet", icon: Sigma,     title: "Formulas",    desc: "Math rendered, not just typed" },
  { color: "sky",    icon: BarChart3, title: "Graphs",      desc: "Data made visual" },
  { color: "emerald", icon: FileText,  title: "Source",      desc: "Reference text pulled into focus" },
];

type Sample = {
  id: string;
  title: string;
  description: string;
  color: string;
  sizeKb: number;
};

type LibraryRow = {
  id: string;
  filename: string;
  uploadedAt: number;
  numPages: number;
  lastActivityAt: number;
  kgStatus: "missing" | "building" | "ready" | "error";
  kgEvaluationCount: number;
};

const FILENAME_TO_TITLE: Record<string, string> = {
  "anatomy.pdf": "Anatomy & Physiology",
  "physics.pdf": "Classical Mechanics",
  "costituzione.pdf": "Costituzione Italiana",
  "calculus.pdf": "Differential & Integral Calculus",
  "chemistry.pdf": "Organic Chemistry",
};

function humaniseAgo(ts: number): string {
  const dt = Date.now() - ts;
  if (dt < 5_000) return "just now";
  if (dt < 60_000) return `${Math.round(dt / 1000)}s ago`;
  if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.round(dt / 3_600_000)}h ago`;
  if (dt < 7 * 86_400_000) return `${Math.round(dt / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function UploadCard() {
  const router = useRouter();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [library, setLibrary] = useState<LibraryRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/api/sample-pdfs")
      .then((r) => r.json())
      .then((j) => setSamples(j.samples || []))
      .catch(() => {});
    fetch("/api/library", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { docs?: LibraryRow[] }) => setLibrary(j.docs ?? []))
      .catch(() => {});
  }, []);

  const libraryPreview = useMemo(() => library.slice(0, 6), [library]);

  const startSample = useCallback(
    async (id: string) => {
      setError(null);
      setBusy(id);
      try {
        const fd = new FormData();
        fd.set("sample", id);
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        if (!r.ok) throw new Error((await r.json()).error ?? "upload failed");
        const j = await r.json();
        router.push(`/viewer/${j.docId}`);
      } catch (e) {
        setError((e as Error).message);
        setBusy(null);
      }
    },
    [router],
  );

  // Upload up to MAX_FILES at once. Each file is converted/validated by
  // /api/upload independently, so we POST them one at a time (keeping the
  // user's Codex usage and the server's parse load steady) and report
  // progress. One file → jump straight into its viewer; several → land in
  // the Library so the whole batch is visible.
  const MAX_FILES = 20;
  const startUploads = useCallback(
    async (fileList: FileList | File[]) => {
      setError(null);
      const picked = Array.from(fileList);
      if (picked.length === 0) return;

      const accepted = picked.filter((f) =>
        /\.(pdf|txt|md|markdown)$/i.test(f.name),
      );
      if (accepted.length === 0) {
        setError("Please pick PDF, .txt, or .md files");
        return;
      }
      const batch = accepted.slice(0, MAX_FILES);
      const notes: string[] = [];
      if (accepted.length > MAX_FILES) {
        notes.push(`Only the first ${MAX_FILES} files were uploaded.`);
      }

      let okCount = 0;
      let firstDocId: string | null = null;
      const failures: string[] = [];

      for (let i = 0; i < batch.length; i++) {
        const file = batch[i];
        setProgress({ i: i + 1, n: batch.length });
        setBusy("upload");
        try {
          const fd = new FormData();
          fd.set("file", file);
          const r = await fetch("/api/upload", { method: "POST", body: fd });
          if (!r.ok) {
            const msg =
              (await r.json().catch(() => ({} as { error?: string }))).error ??
              "upload failed";
            failures.push(`${file.name}: ${msg}`);
            continue;
          }
          const j = await r.json();
          okCount += 1;
          if (!firstDocId) firstDocId = j.docId as string;
        } catch (e) {
          failures.push(`${file.name}: ${(e as Error).message}`);
        }
      }

      setProgress(null);

      // If anything was skipped or failed, stay on the page and show a
      // summary so the user sees exactly what happened (navigating away
      // would hide it). Successful files are already in the Library.
      if (failures.length > 0 || notes.length > 0) {
        setBusy(null);
        const summary: string[] = [...notes];
        if (okCount > 0) summary.push(`${okCount} added to your Library.`);
        if (failures.length > 0)
          summary.push(`${failures.length} couldn't be added:\n${failures.join("\n")}`);
        setError(summary.join("\n"));
        return;
      }

      // Clean run: 1 file → open it; many → show the batch in the Library.
      if (batch.length === 1 && firstDocId) {
        router.push(`/viewer/${firstDocId}`);
      } else {
        router.push(`/library`);
      }
    },
    [router],
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-10 py-14">
      <h1 className="text-balance text-[44px] font-bold leading-[1.08] tracking-tight text-[var(--ink-900)]">
        Read it. See it.{" "}
        <span
          className="font-black tracking-[-0.02em]"
          style={{ fontSize: "1.28em" }}
        >
          Get It.
        </span>
      </h1>

      <p className="mt-7 max-w-2xl text-[15px] leading-[1.65] text-[var(--ink-700)]">
        Drop your PDFs, text, or Markdown files (up to 20 at once). Their hardest concepts come alive inline as you read.
        Chat with it, drill yourself, explain it back to a curious
        eight-year-old. Watch a map of what you actually understand
        grow, concept by concept, not page by page.
      </p>

      {/* Drop zone — output-type badges + CTA button */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = e.dataTransfer.files;
          if (files && files.length > 0) startUploads(files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        className={[
          "mt-9 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-9 text-center transition-colors",
          dragOver
            ? "border-[var(--accent-500)] bg-[var(--accent-50)]"
            : "border-[var(--accent-100)] bg-[var(--accent-50)]/40 hover:border-[var(--accent-500)] hover:bg-[var(--accent-50)]",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,.pdf,.txt,.md,.markdown,text/plain,text/markdown"
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) startUploads(files);
          }}
        />
        {/* Output-type badges — what we'll generate from the PDF */}
        <div className="mb-4 flex items-center justify-center gap-2">
          {FEATURES.map(({ color, icon: Icon, title }) => (
            <span
              key={color}
              title={title}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border"
              style={{
                background: `var(--tag-${color}-bg)`,
                color: `var(--tag-${color}-fg)`,
                borderColor: `var(--tag-${color}-ring)`,
              }}
            >
              <Icon className="h-4 w-4" />
            </span>
          ))}
        </div>
        <p className="flex flex-wrap items-center justify-center gap-2 text-[14px] text-[var(--ink-700)]">
          {busy === "upload" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-600)]" />
              <span className="font-medium text-[var(--ink-900)]">
                {progress && progress.n > 1
                  ? `Uploading and parsing ${progress.i} of ${progress.n}…`
                  : "Uploading and parsing…"}
              </span>
            </>
          ) : (
            <>
              <span>Drop your PDFs, .txt, or .md files here, or</span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-600)] px-3 py-1 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-[var(--accent-700)]">
                <Upload className="h-3.5 w-3.5" />
                Select files
              </span>
            </>
          )}
        </p>
        <p className="mt-3 text-[11.5px] text-[var(--ink-400)]">
          Text-tagged PDFs work best. No OCR. .txt and .md welcome.
        </p>
      </div>

      {/* Upload error / rejected-document alert — prominent, right under the
          drop zone so the cause is obvious the moment a bad PDF is refused. */}
      {error && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3.5"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-rose-900">
              We couldn&rsquo;t open this document
            </p>
            <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-rose-800">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-rose-400 transition hover:bg-rose-100 hover:text-rose-700"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Library — only render if there's actually something to show */}
      {libraryPreview.length > 0 && (
        <div className="mt-12">
          <div className="mb-4 flex items-baseline justify-between">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-400)]">
              Your library
            </p>
            {library.length > libraryPreview.length ? (
              <Link
                href="/library"
                className="text-[11px] font-medium text-[var(--accent-700)] hover:underline"
              >
                See all {library.length}
              </Link>
            ) : (
              <Link
                href="/library"
                className="text-[11px] font-medium text-[var(--accent-700)] hover:underline"
              >
                Open Library
              </Link>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {libraryPreview.map((d) => {
              const title =
                FILENAME_TO_TITLE[d.filename] ?? d.filename.replace(/\.(pdf|txt|md|markdown)$/i, "");
              return (
                <Link
                  key={d.id}
                  href={`/viewer/${d.id}`}
                  className="group flex items-start gap-4 rounded-xl border border-[var(--border-subtle)] bg-white p-4 text-left transition hover:border-[var(--border-strong)]"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)] text-[var(--ink-500)]">
                    <FileText className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-[var(--ink-900)]">
                      {title}
                    </p>
                    <p className="mt-0.5 truncate text-[11.5px] text-[var(--ink-500)]">
                      {d.numPages} page{d.numPages === 1 ? "" : "s"} · last opened {humaniseAgo(d.lastActivityAt)}
                    </p>
                    {d.kgStatus === "ready" && d.kgEvaluationCount > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        <Network className="h-2.5 w-2.5" />
                        {d.kgEvaluationCount} eval{d.kgEvaluationCount === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                  <div className="self-center text-[var(--ink-400)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink-900)]">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Sample documents — Reflect-grade list cards */}
      <div className="mt-12">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-400)]">
          Sample documents
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {samples.map((s) => {
            const sampleIcon = SAMPLE_ICONS[s.id] ?? DEFAULT_SAMPLE_ICON;
            const SampleIcon = sampleIcon.Icon;

            return (
              <button
                key={s.id}
                onClick={() => startSample(s.id)}
                disabled={busy != null}
                className="group flex items-start gap-4 rounded-xl border border-[var(--border-subtle)] bg-white p-4 text-left transition hover:border-[var(--border-strong)] disabled:opacity-50"
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)]"
                  style={{
                    color: `var(--tag-${sampleIcon.tone}-fg)`,
                  }}
                  title={sampleIcon.label}
                >
                  <SampleIcon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-[var(--ink-900)]">{s.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-[var(--ink-500)]">
                    {s.description}
                  </p>
                  <div className="mt-2 text-[11px] tabular-nums text-[var(--ink-400)]">{s.sizeKb} KB</div>
                </div>
                <div className="self-center text-[var(--ink-400)] transition group-hover:translate-x-0.5 group-hover:text-[var(--ink-900)]">
                  {busy === s.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-600)]" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
