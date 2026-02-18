'use client';

import { useState, useEffect, useRef } from 'react';
import { Share2, Copy, Check } from 'lucide-react';

interface ShareButtonProps {
  url: string;
  text: string;
  label?: string;
  className?: string;
}

export function ShareButton({ url, text, label = 'Share', className }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={
          className ||
          'flex items-center gap-2 px-4 py-2 bg-chess-surface border border-chess-border rounded-lg text-sm hover:border-chess-accent/50 transition-colors'
        }
      >
        <Share2 className="w-4 h-4" />
        {label}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 bg-chess-surface border border-chess-border rounded-lg p-1.5 shadow-xl z-50 min-w-[180px]">
          <a
            href={twitterUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-chess-border/50 rounded transition-colors w-full"
            onClick={() => setOpen(false)}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Share on X
          </a>
          <button
            onClick={() => {
              navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
                setOpen(false);
              }, 1500);
            }}
            className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-chess-border/50 rounded transition-colors w-full text-left"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      )}
    </div>
  );
}
