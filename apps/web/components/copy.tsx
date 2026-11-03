"use client";

import { useState } from "react";

/** Copies public text (commands, hashes). Never pass secrets here. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
