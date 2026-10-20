"use client";

import { useCallback, useEffect, useRef } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * The email as it would be sent: the HTML in a frame (links open in a new tab), and the plain-text
 * alternative. The frame keeps the email's own colours in both themes, as a mail client would. It
 * isn't sandboxed: the HTML is built here from escaped text and has no scripts (a unit test checks
 * that), and a sandbox only stops axe and Playwright from reading it.
 */
export function SnapshotPreview({ html, text }: { html: string; text: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Grow the frame to the email's height, so the page scrolls instead of the frame.
  const fit = useCallback(() => {
    const document = frame.current?.contentDocument;
    if (frame.current && document) {
      frame.current.style.height = `${document.documentElement.scrollHeight}px`;
    }
  }, []);
  // The frame may finish loading before hydration attaches onLoad.
  useEffect(() => {
    if (frame.current?.contentDocument?.readyState === "complete") fit();
  }, [fit, html]);

  return (
    <Tabs defaultValue="html" className="gap-4">
      <TabsList>
        <TabsTrigger value="html">Email</TabsTrigger>
        <TabsTrigger value="text">Plain text</TabsTrigger>
      </TabsList>
      <TabsContent value="html">
        <iframe
          ref={frame}
          title="Snapshot email"
          srcDoc={html}
          onLoad={fit}
          className="block h-[1400px] w-full max-w-[680px] rounded-lg border bg-white"
          data-testid="snapshot-frame"
        />
      </TabsContent>
      <TabsContent value="text">
        <pre
          className="max-w-[680px] overflow-x-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap"
          data-testid="snapshot-text"
        >
          {text}
        </pre>
      </TabsContent>
    </Tabs>
  );
}
