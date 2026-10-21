import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ConfigError } from "@/lib/server/config";
import { appUrl, todaysSnapshot } from "@/lib/server/snapshot";
import { recipients, transportKind } from "@/lib/server/snapshot/transport";

import { SnapshotPreview } from "./preview";

export const metadata: Metadata = { title: "Daily snapshot" };

/** Where the email would go, for the line above the preview. Config errors are shown, not thrown. */
function delivery(): string {
  try {
    const kind = transportKind();
    const to = recipients();
    const count = `${to.length} ${to.length === 1 ? "recipient" : "recipients"}`;
    return kind === "graph"
      ? `Sent with Microsoft Graph to ${count} in SNAPSHOT_TO.`
      : `Written to SNAPSHOT_DIR as .html and .txt (file transport; ${count} in SNAPSHOT_TO).`;
  } catch (error) {
    return error instanceof ConfigError ? error.message : "The transport settings couldn't be read.";
  }
}

async function Preview() {
  const request = await headers();
  const host = request.get("x-forwarded-host") ?? request.get("host") ?? "localhost";
  const protocol = request.get("x-forwarded-proto") ?? "http";
  const { email } = await todaysSnapshot(appUrl(`${protocol}://${host}`));
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid max-w-[680px] grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Subject</dt>
        <dd className="font-medium" data-testid="snapshot-subject">
          {email.subject}
        </dd>
        <dt className="text-muted-foreground">Delivery</dt>
        <dd>{delivery()}</dd>
      </dl>
      <SnapshotPreview html={email.html} text={email.text} />
    </div>
  );
}

function PreviewSkeleton() {
  return (
    <div className="flex max-w-[680px] flex-col gap-3" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-5 w-80" />
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-[600px] w-full" />
    </div>
  );
}

/** Today's snapshot email exactly as it would be sent. Not in the nav rail: the manager and QA open it. */
export default function SnapshotPage() {
  return (
    <>
      <div className="mb-6 flex flex-col gap-1 md:mb-8">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Daily snapshot</h1>
        <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
          Today&rsquo;s email of MBAL&rsquo;s headline figures, exactly as it would be sent. All companies;
          the filters don&rsquo;t apply.
        </p>
      </div>
      <Suspense fallback={<PreviewSkeleton />}>
        <Preview />
      </Suspense>
    </>
  );
}
