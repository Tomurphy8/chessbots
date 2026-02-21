'use client';

import { cn } from '@/lib/utils';

const bracketColors: Record<string, { bg: string; text: string; border: string }> = {
  unrated: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/40' },
  class_c: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/40' },
  class_b: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/40' },
  class_a: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/40' },
  open: { bg: 'bg-chess-gold/20', text: 'text-chess-gold', border: 'border-chess-gold/40' },
};

const bracketLabels: Record<string, string> = {
  unrated: 'Unrated',
  class_c: 'Class C',
  class_b: 'Class B',
  class_a: 'Class A',
  open: 'Open',
};

function getBracket(elo: number, tournamentCount: number): string {
  if (tournamentCount < 10) return 'unrated';
  if (elo >= 2000) return 'open';
  if (elo >= 1600) return 'class_a';
  if (elo >= 1200) return 'class_b';
  return 'class_c';
}

interface ELOBadgeProps {
  elo: number;
  bracket?: string;
  tournamentCount?: number;
  size?: 'sm' | 'md' | 'lg';
  showBracket?: boolean;
}

export default function ELOBadge({
  elo,
  bracket,
  tournamentCount = 0,
  size = 'md',
  showBracket = true,
}: ELOBadgeProps) {
  const resolvedBracket = bracket || getBracket(elo, tournamentCount);
  const colors = bracketColors[resolvedBracket] || bracketColors.unrated;
  const label = bracketLabels[resolvedBracket] || 'Unrated';

  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5 gap-1',
    md: 'text-sm px-2 py-1 gap-1.5',
    lg: 'text-base px-3 py-1.5 gap-2',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border font-medium',
        colors.bg,
        colors.text,
        colors.border,
        sizeClasses[size],
      )}
    >
      <span className="font-bold">{elo}</span>
      {showBracket && (
        <span className="opacity-75">{label}</span>
      )}
    </span>
  );
}
