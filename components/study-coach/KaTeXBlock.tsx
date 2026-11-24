"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

interface KaTeXBlockProps {
  snippet: string;
  kind: "latex" | "code";
}

export function KaTeXBlock({ snippet, kind }: KaTeXBlockProps) {
  const renderedHtml = useMemo(() => {
    if (kind !== "latex") return null;
    try {
      return katex.renderToString(snippet, {
        displayMode: true,
        throwOnError: false,
        strict: false,
      });
    } catch {
      return null;
    }
  }, [kind, snippet]);

  if (renderedHtml) {
    return (
      <div
        className="overflow-x-auto rounded-lg border border-white/10 bg-[#141b38] px-3 py-2 text-slate-100"
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    );
  }

  return (
    <pre className="overflow-x-auto rounded-lg border border-white/10 bg-[#080c1d] px-3 py-2 font-mono text-xs leading-relaxed text-slate-100">
      <code>{snippet}</code>
    </pre>
  );
}
