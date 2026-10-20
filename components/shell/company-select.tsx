"use client";

import { use, useState } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Company } from "@/lib/server/queries/common";
import { cn } from "@/lib/utils";

import { useShell } from "./shell-context";

/** Placeholder while the company list loads. */
export function CompanySelectFallback() {
  return (
    <Button variant="outline" className="h-9 gap-2 font-normal" disabled>
      <Building2 className="text-muted-foreground" aria-hidden />
      <span className="sr-only">Companies:</span>
      <span className="font-medium">All companies</span>
      <ChevronDown className="ml-auto text-muted-foreground" aria-hidden />
    </Button>
  );
}

/** Searchable multi-select of companies. Nothing selected means all companies. */
export function CompanySelect({ companies: companiesPromise }: { companies: Promise<Company[]> }) {
  const companies = use(companiesPromise);
  const { filters, setFilters } = useShell();
  const [open, setOpen] = useState(false);
  const selected = new Set(filters.companies);

  const label =
    selected.size === 0
      ? "All companies"
      : selected.size === 1
        ? (companies.find((company) => selected.has(company.code))?.name ?? [...selected][0])
        : `${selected.size} companies`;

  function toggle(code: string) {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setFilters({ companies: [...next].sort() });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="h-9 min-w-0 justify-start gap-2 font-normal"
          data-testid="company-trigger"
        >
          <Building2 className="text-muted-foreground" aria-hidden />
          <span className="sr-only">Companies:</span>
          <span className="max-w-40 truncate font-medium">{label}</span>
          <ChevronDown className="ml-auto text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-0">
        <Command>
          <CommandInput placeholder="Search companies…" aria-label="Search companies" />
          <CommandList>
            <CommandEmpty>
              {companies.length === 0 ? "Companies couldn't be loaded." : "No company matches."}
            </CommandEmpty>
            <CommandGroup>
              {companies.map((company) => (
                <CommandItem
                  key={company.code}
                  value={`${company.code} ${company.name}`}
                  onSelect={() => toggle(company.code)}
                  data-checked={selected.has(company.code)}
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm border border-input",
                      selected.has(company.code) && "border-primary bg-primary text-primary-foreground",
                    )}
                    aria-hidden
                  >
                    {selected.has(company.code) && <Check className="size-3" />}
                  </span>
                  <span className="truncate">{company.name}</span>
                  <span className="tabular ml-auto text-xs text-muted-foreground">{company.code}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => setFilters({ companies: [] })} className="justify-center">
                    Clear selection (all companies)
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
