import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// Same faces as the 8 Sync dashboards (content-ai DESIGN.md): Inter for every word, JetBrains Mono for ids, paths and
// numbers. Both are variable fonts and ship the `vietnamese` subset (ă đ ơ ư and every stacked tone mark), so a
// Vietnamese word never falls back to a second family. Two files per subset on first paint.
const inter = Inter({ subsets: ["vietnamese", "latin"], variable: "--font-inter", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["vietnamese", "latin"], variable: "--font-jetbrains-mono", display: "swap" });

export const metadata: Metadata = {
  title: "8 Sync HQ",
  description: "Local team view for your Claude Code sessions",
  // Brand kit 2026-09 ("The Cut"); app/favicon.ico carries the 16/32/48 PNGs. Root paths on purpose: a site that mounts HQ under /hq proxies them by name.
  icons: { icon: { url: "/8sync-mark.svg", type: "image/svg+xml" }, apple: "/apple-touch-icon.png" },
};

/** cover: the app pads itself with env(safe-area-inset-*) (hq-app root, bottom sheets), so a phone's notch and home indicator never sit on a control. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`h-full ${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="h-full overflow-hidden">
        {/* Light first (owner 2026-11-02); dark stays one tap away in the sidebar, and an explicit pick is kept (next-themes stores it). */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
