import Link from "next/link";
import UploadCard from "@/components/UploadCard";
import {
  Upload,
  BookOpen,
  FileText,
  StickyNote,
  Bookmark,
  NotebookPen,
  ScrollText,
  Spline,
  Workflow,
  Shuffle,
  Undo2,
  Redo2,
} from "lucide-react";

// Subtle background ornaments that fill the empty side margins on wider
// screens. Hidden below `lg` so they never crowd the content.
const ORNAMENTS = [
  { Icon: FileText,    side: "left",  top: "6%",  off: "5%",  rot: -10, size: 56 },
  { Icon: Bookmark,    side: "left",  top: "26%", off: "12%", rot: -18, size: 38 },
  { Icon: Spline,      side: "left",  top: "44%", off: "3%",  rot: 14,  size: 64 },
  { Icon: NotebookPen, side: "left",  top: "62%", off: "9%",  rot: -6,  size: 48 },
  { Icon: Undo2,       side: "left",  top: "82%", off: "4%",  rot: 22,  size: 52 },
  { Icon: ScrollText,  side: "right", top: "10%", off: "6%",  rot: 12,  size: 60 },
  { Icon: Workflow,    side: "right", top: "30%", off: "2%",  rot: -8,  size: 50 },
  { Icon: StickyNote,  side: "right", top: "50%", off: "10%", rot: 18,  size: 44 },
  { Icon: Shuffle,     side: "right", top: "68%", off: "4%",  rot: -14, size: 56 },
  { Icon: Redo2,       side: "right", top: "86%", off: "11%", rot: 8,   size: 46 },
] as const;

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col bg-[var(--surface-canvas)] text-[var(--ink-900)]">
      {/* Top tab bar — Reflect-style browser-tabs */}
      <div className="tab-bar tab-bar--fused">
        <div className="tab-item" data-active="true">
          <Upload className="h-3.5 w-3.5 text-[var(--accent-600)]" />
          <span>Upload</span>
        </div>
        <Link href="/library" className="tab-item">
          <BookOpen className="h-3.5 w-3.5 text-[var(--ink-400)]" />
          <span>Library</span>
        </Link>
      </div>

      {/* White content sheet */}
      <div className="relative flex-1 overflow-hidden bg-[var(--surface-raised)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden select-none lg:block"
        >
          {ORNAMENTS.map(({ Icon, side, top, off, rot, size }, i) => (
            <Icon
              key={i}
              strokeWidth={1.4}
              className="absolute text-black/[0.05]"
              style={{
                top,
                [side]: off,
                width: size,
                height: size,
                transform: `rotate(${rot}deg)`,
              }}
            />
          ))}
        </div>
        <div className="relative">
          <UploadCard />
        </div>
      </div>
    </main>
  );
}
