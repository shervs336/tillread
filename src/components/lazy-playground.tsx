"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

function Skeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" role="status" aria-busy="true" aria-label="Loading the playground">
      <div className="h-[260px] animate-pulse rounded-2xl border border-line bg-surface" />
      <div className="h-[260px] animate-pulse rounded-2xl border border-line bg-surface" />
      <div className="h-[420px] animate-pulse rounded-2xl border border-line bg-surface lg:col-span-2" />
    </div>
  );
}

const Playground = dynamic(() => import("./playground").then((m) => m.Playground), { ssr: false, loading: Skeleton });

/**
 * Loads the playground (and the parser) only when its section comes near the screen, so the first
 * paint on a phone doesn't wait for code the reader may never scroll to.
 */
export function LazyPlayground() {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref}>{show ? <Playground /> : <Skeleton />}</div>;
}
