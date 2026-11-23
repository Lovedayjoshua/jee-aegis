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
        className="overflow-x-auto rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900"
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
      />
    );
  }

  return (
    <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-900 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100">
      <code>{snippet}</code>
    </pre>
  );
}
