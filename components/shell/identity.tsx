"use client";

import Image from "next/image";
import { Suspense, use } from "react";
import { BarChart3 } from "lucide-react";

import { monogram } from "@/lib/company-identity";
import type { Company } from "@/lib/server/queries/common";
import { cn } from "@/lib/utils";

import { useShell } from "./shell-context";

export interface IdentityProps {
  companies: Promise<Company[]>;
  /** Company code → logo URL, from `public/logos/`. */
  logos: Record<string, string>;
}

/** The selected company when exactly one is, else null (all companies, or several). */
function useSingleCompany(): string | null {
  const { filters } = useShell();
  return filters.companies.length === 1 ? filters.companies[0] : null;
}

function AppMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-[22%] bg-navy text-white", className)}
      aria-hidden
    >
      <BarChart3 className="size-1/2" />
    </span>
  );
}

function CompanyMark({
  code,
  name,
  logo,
  className,
  testIds,
}: {
  code: string;
  name: string;
  logo: string | undefined;
  className?: string;
  testIds?: boolean;
}) {
  return logo ? (
    <Image
      src={logo}
      alt=""
      width={96}
      height={96}
      unoptimized
      className={cn("shrink-0 rounded-[22%] bg-white object-contain p-0.5 ring-1 ring-border", className)}
      data-testid={testIds ? "company-logo" : undefined}
    />
  ) : (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[22%] bg-navy font-semibold tracking-tight text-white",
        className,
      )}
      aria-hidden
      data-testid={testIds ? "company-monogram" : undefined}
      title={code}
    >
      {monogram(name)}
    </span>
  );
}

/** A company's name from the list, or its code until the list knows it. */
function nameOf(companies: Company[], code: string): string {
  return companies.find((company) => company.code === code)?.name ?? code;
}

function SingleMark({
  code,
  companies,
  logos,
  className,
}: IdentityProps & { code: string; className?: string }) {
  return (
    <CompanyMark code={code} name={nameOf(use(companies), code)} logo={logos[code]} className={className} />
  );
}

/** The logo at the top of the nav rail: the selected company's, or the app's own mark. */
export function IdentityMark({ companies, logos, className }: IdentityProps & { className?: string }) {
  const single = useSingleCompany();
  if (!single) return <AppMark className={className} />;
  return (
    <Suspense fallback={<AppMark className={className} />}>
      <SingleMark code={single} companies={companies} logos={logos} className={className} />
    </Suspense>
  );
}

function AppIdentity() {
  return (
    <>
      <AppMark className="size-9 text-lg sm:size-11" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-base font-semibold">MBAL BI</span>
        <span className="truncate text-xs text-muted-foreground">Orion ERP analytics</span>
      </span>
    </>
  );
}

function CompanyIdentity({ code, companies, logos }: IdentityProps & { code: string }) {
  const name = nameOf(use(companies), code);
  return (
    <>
      <CompanyMark code={code} name={name} logo={logos[code]} className="size-9 text-sm sm:size-11" testIds />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-base font-semibold" data-testid="company-identity-name">
          {name}
        </span>
        <span className="truncate text-xs text-muted-foreground">MBAL BI · Orion ERP analytics</span>
      </span>
    </>
  );
}

/** The header's logo, company name and subtitle: one company selected, or MBAL BI. */
export function IdentityBlock({ companies, logos }: IdentityProps) {
  const single = useSingleCompany();
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="app-identity">
      {single ? (
        <Suspense fallback={<AppIdentity />}>
          <CompanyIdentity code={single} companies={companies} logos={logos} />
        </Suspense>
      ) : (
        <AppIdentity />
      )}
    </div>
  );
}
