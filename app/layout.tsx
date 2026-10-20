import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { Suspense } from "react";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { ScrollToHash } from "@/components/shell/scroll-to-hash";
import { ShellProvider } from "@/components/shell/shell-context";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { TopBar } from "@/components/shell/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { todayIso } from "@/lib/filters";
import { isSampleMode } from "@/lib/server/config";
import { companies as loadCompanies, type Company } from "@/lib/server/queries/common";

import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "MBAL BI", template: "%s · MBAL BI" },
  description: "Business-intelligence dashboards on Orion, MBAL's ERP.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page reads live data: render per request, never at build time.
  await connection();
  const sample = isSampleMode();
  // Not awaited, so a slow or unreachable Orion never holds up the page; the filter streams in.
  // On failure the filter says "couldn't be loaded" and the page itself shows the friendly error.
  const companies: Promise<Company[]> = loadCompanies().catch(() => []);

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={300}>
            {/* useSearchParams in the shell needs a Suspense boundary. */}
            <Suspense>
              <ShellProvider today={todayIso()}>
                <SidebarProvider>
                  <AppSidebar sourceLabel={sample ? "sample data" : "Orion"} />
                  <SidebarInset className="min-w-0">
                    <TopBar companies={companies} sample={sample} />
                    <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6 md:py-8">
                      {children}
                    </div>
                    <ScrollToHash />
                  </SidebarInset>
                </SidebarProvider>
              </ShellProvider>
            </Suspense>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
