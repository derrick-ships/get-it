import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Braynr Visualizer — read with a brain on your shoulder",
  description:
    "Drop in any tagged PDF. Braynr's agent picks the concepts that benefit from a picture and renders them in 3D, animation, formulas, graphs, or live sources right next to the text.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--surface-canvas)] text-[var(--ink-900)]">
        {children}
      </body>
    </html>
  );
}
