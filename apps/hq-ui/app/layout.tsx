import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const beVietnam = Be_Vietnam_Pro({
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-be-vietnam",
  display: "swap",
});

export const metadata: Metadata = {
  title: "8 Sync HQ",
  description: "Local team view for your Claude Code sessions",
  icons: { icon: "/8sync-mark.svg" },
};

/** cover: the app pads itself with env(safe-area-inset-*) (hq-app root, bottom sheets), so a phone's notch and home indicator never sit on a control. */
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full ${geist.variable} ${geistMono.variable} ${beVietnam.variable}`} suppressHydrationWarning>
      <body className="h-full overflow-hidden">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
