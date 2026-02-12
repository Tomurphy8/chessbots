'use client';

import { Megaphone } from 'lucide-react';

interface SponsorBannerProps {
  name: string;
  uri?: string;
  amount: string;
  isImageUri: boolean;
  compact?: boolean;
}

export function SponsorBanner({ name, uri, amount, isImageUri, compact = false }: SponsorBannerProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Megaphone className="w-3 h-3" />
        <span>Sponsored by <span className="text-gray-300 font-medium">{name}</span></span>
      </div>
    );
  }

  return (
    <div className="bg-chess-surface/80 border border-chess-border/50 rounded-lg p-3 w-full">
      <div className="flex items-center gap-3">
        {isImageUri && uri ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={uri}
            alt={`${name} logo`}
            className="max-h-10 w-auto rounded object-contain"
          />
        ) : (
          <div className="flex items-center justify-center w-10 h-10 rounded bg-chess-accent/10">
            <Megaphone className="w-5 h-5 text-chess-accent-light" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Sponsored by</span>
            {uri && !isImageUri ? (
              <a
                href={uri}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-chess-accent-light hover:text-white transition-colors truncate"
              >
                {name}
              </a>
            ) : (
              <span className="text-sm font-medium text-gray-200 truncate">{name}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {parseFloat(amount).toLocaleString()} USDC contributed to prize pool
          </p>
        </div>
      </div>
    </div>
  );
}
