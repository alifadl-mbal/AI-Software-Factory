import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";

import { auth } from "@/auth";
import { FiltersAside, FiltersSheet } from "@/components/shell/filters-panel";
import { NavBar, NavRail } from "@/components/shell/nav-rail";
import { NoSignInBanner } from "@/components/shell/no-sign-in-banner";
import { ScrollToHash } from "@/components/shell/scroll-to-hash";
import { ShellProvider } from "@/components/shell/shell-context";
import { ShellHeader } from "@/components/shell/shell-header";
import { ThemeProvider } from "@/components/shell/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NAV_RAIL_COOKIE } from "@/lib/dashboards";
import { todayIso } from "@/lib/filters";
import { accessMode } from "@/lib/server/access";
import { isSampleMode } from "@/lib/server/config";
import { companyLogos } from "@/lib/server/logos";
import { companies as loadCompanies, type Company } from "@/lib/server/queries/common";

import "./globals.css";

// Geist 400–700, as on TNS; figures are tabular everywhere (globals.css).
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "MBAL BI", template: "%s · MBAL BI" },
  description: "Business-intelligence dashboards on Orion, MBAL's ERP.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page reads live data: render per request, never at build time.
  await connection();
  const mode = accessMode();
  const session = mode === "auth" ? await auth() : null;
  // Signed out, not allowed in, or locked: proxy.ts has sent the request to a sign-in page, which
  // gets no shell, and nothing here may load data.
  if (mode === "locked" || (mode === "auth" && !(session?.user && session.allowed))) {
    return (
      <html
        lang="en"
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <body>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
          </ThemeProvider>
        </body>
      </html>
    );
  }
  const user = session?.user ? { name: session.user.name ?? null, email: session.user.email ?? null } : null;
  const sample = isSampleMode();
  // Not awaited, so a slow or unreachable Orion never holds up the page; the filter streams in.
  // On failure the filter says "couldn't be loaded" and the page itself shows the friendly error.
  const companies: Promise<Company[]> = loadCompanies().catch(() => []);
  const navExpanded = (await cookies()).get(NAV_RAIL_COOKIE)?.value === "expanded";
  const logos = companyLogos();
  const sourceLabel = sample ? "sample data" : "Orion";

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
                {/* The TNS layout: gradient page, nav rail, and one large rounded panel. */}
                <div className="flex min-h-svh flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-8">
                  <NavRail
                    sourceLabel={sourceLabel}
                    companies={companies}
                    logos={logos}
                    defaultExpanded={navExpanded}
                  />
                  <NavBar sourceLabel={sourceLabel} companies={companies} logos={logos} />
                  <div className="flex min-w-0 flex-1 flex-col gap-5 rounded-[32px] bg-background p-3 shadow-outer sm:p-5">
                    {mode === "dev-warning" && <NoSignInBanner />}
                    <ShellHeader companies={companies} logos={logos} sample={sample} user={user} />
                    <div className="flex min-w-0 items-start gap-6">
                      <FiltersAside companies={companies} />
                      <main className="flex min-w-0 flex-1 flex-col gap-4">
                        <FiltersSheet companies={companies} />
                        <div className="min-w-0">{children}</div>
                      </main>
                    </div>
                  </div>
                  <ScrollToHash />
                </div>
              </ShellProvider>
            </Suspense>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
