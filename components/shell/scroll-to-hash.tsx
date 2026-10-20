"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Give up waiting for the page to settle after this long. */
const SETTLE_TIMEOUT_MS = 15_000;

/**
 * Links like `/inventory#reorder-alerts` (from the Overview's "Needs attention") point at a section
 * that streams in. The browser scrolls to it while the skeletons above are still loading, and the
 * section then moves as they fill in. This scrolls to the anchor again once nothing is loading,
 * unless the reader has started scrolling themselves.
 */
export function ScrollToHash() {
  const pathname = usePathname();

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    let done = false;
    const observer = new MutationObserver(() => settle());
    const stop = () => {
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      for (const event of ["wheel", "touchstart", "keydown"]) window.removeEventListener(event, stop);
    };
    function settle() {
      if (done) return;
      const target = document.getElementById(id);
      if (!target || document.querySelector('[aria-busy="true"]')) return;
      stop();
      target.scrollIntoView({ block: "start" });
    }
    const timer = setTimeout(stop, SETTLE_TIMEOUT_MS);
    for (const event of ["wheel", "touchstart", "keydown"])
      window.addEventListener(event, stop, { passive: true });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-busy"],
    });
    settle();
    return stop;
  }, [pathname]);

  return null;
}
