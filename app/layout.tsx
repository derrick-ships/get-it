import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import CodexHealthBanner from "@/components/CodexHealthBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Reading-optimized serif for the Reader body (Readwise-style). Switchable to
// sans in the reader's appearance panel.
const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Get It.",
  description:
    "Drop in any tagged PDF. Get It.'s agents pick the concepts that benefit from a picture and render them in 3D, animation, formulas, graphs, or live sources right next to the text — and back-reflect your mastery onto a knowledge graph.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col overflow-hidden bg-[var(--surface-canvas)] text-[var(--ink-900)]">
        <CodexHealthBanner />
        {children}
      </body>
    </html>
  );
}
