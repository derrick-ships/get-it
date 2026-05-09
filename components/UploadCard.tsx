"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileUp, Loader2, ArrowRight, Tag as TagIcon, ChevronDown } from "lucide-react";

type Sample = {
  id: string;
  title: string;
  description: string;
  color: string;
  sizeKb: number;
};

export default function UploadCard() {
  const router = useRouter();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/api/sample-pdfs")
      .then((r) => r.json())
      .then((j) => setSamples(j.samples || []))
      .catch(() => {});
  }, []);

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

  const startUpload = useCallback(
    async (file: File) => {
      setError(null);
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please pick a PDF file");
        return;
      }
      setBusy("upload");
      try {
        const fd = new FormData();
        fd.set("file", file);
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

  return (
    <div className="mx-auto w-full max-w-4xl px-10 py-14">
      {/* Header row — chips above the title, just like the mockup */}
      <div className="mb-5 flex items-center gap-2">
        <button type="button" className="chip-soft">
          <FileUp className="h-3 w-3" />
          Note
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
        <button type="button" className="chip-plain">
          <FileUp className="h-3 w-3" />
          Collections
        </button>
      </div>

      <h1 className="text-balance text-[44px] font-bold leading-[1.08] tracking-tight text-[var(--ink-900)]">
        Read with a brain on your shoulder.
      </h1>

      <div className="mt-3 flex items-center gap-2 text-[13px] text-[var(--ink-400)]">
        <TagIcon className="h-3.5 w-3.5" />
        <span>Tags</span>
      </div>

      <p className="mt-7 max-w-2xl text-[15px] leading-[1.65] text-[var(--ink-700)]">
        Drop in any well-tagged PDF. Braynr&apos;s agent reads it, picks the
        concepts that benefit from a picture, and renders them — 3D models,
        animated simulations, formulas, graphs, or live source citations —
        right next to the text.
      </p>

      {/* Drop zone */}
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
          const f = e.dataTransfer.files?.[0];
          if (f) startUpload(f);
        }}
        className={[
          "mt-9 cursor-pointer rounded-2xl border bg-white px-8 py-10 text-center transition-colors",
          dragOver
            ? "border-[var(--accent-500)] bg-[var(--accent-50)]"
            : "border-dashed border-[var(--border-default)] hover:border-[var(--border-strong)]",
        ].join(" ")}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) startUpload(f);
          }}
        />
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-50)] ring-1 ring-[var(--accent-100)]">
          {busy === "upload" ? (
            <Loader2 className="h-5 w-5 animate-spin text-[var(--accent-600)]" />
          ) : (
            <Upload className="h-5 w-5 text-[var(--accent-600)]" />
          )}
        </div>
        <p className="text-[14px] font-medium text-[var(--ink-900)]">
          {busy === "upload" ? "Uploading and parsing…" : "Drop a PDF here, or click to browse"}
        </p>
        <p className="mt-1 text-[12px] text-[var(--ink-400)]">
          Best with text-tagged PDFs. We don&apos;t OCR images.
        </p>
      </div>

      {/* Sample documents — Reflect-grade list cards */}
      <div className="mt-12">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-400)]">
          Sample documents
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {samples.map((s) => (
            <button
              key={s.id}
              onClick={() => startSample(s.id)}
              disabled={busy != null}
              className="group flex items-start gap-4 rounded-xl border border-[var(--border-subtle)] bg-white p-4 text-left transition hover:border-[var(--border-strong)] disabled:opacity-50"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-sunken)]">
                <FileUp className="h-4 w-4 text-[var(--ink-700)]" />
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
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-6 text-center text-sm text-rose-600">{error}</p>
      )}
    </div>
  );
}
