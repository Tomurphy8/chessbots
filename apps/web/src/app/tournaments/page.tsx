'use client';

import { useState } from 'react';
import { TournamentCard } from '@/components/TournamentCard';
import { useTournaments } from '@/lib/hooks/useChainData';
import { cn } from '@/lib/utils';

const TIERS = ['all', 'rookie', 'bronze', 'silver', 'masters', 'legends', 'free'] as const;
const STATUSES = ['all', 'registration', 'round_active', 'completed', 'cancelled'] as const;

export default function TournamentsPage() {
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const { tournaments, loading } = useTournaments();

  const filtered = tournaments.filter((t) => {
    if (tierFilter !== 'all' && t.tier !== tierFilter) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    return true;
  });

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Tournaments</h1>

      <div className="flex flex-wrap gap-4 mb-8">
        <div className="flex gap-2">
          {TIERS.map((tier) => (
            <button
              key={tier}
              onClick={() => setTierFilter(tier)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors capitalize',
                tierFilter === tier
                  ? 'border-chess-accent bg-chess-accent/20 text-chess-accent-light'
                  : 'border-chess-border text-gray-400 hover:text-white',
              )}
            >
              {tier}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {STATUSES.map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors capitalize',
                statusFilter === status
                  ? 'border-chess-accent bg-chess-accent/20 text-chess-accent-light'
                  : 'border-chess-border text-gray-400 hover:text-white',
              )}
            >
              {status.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading tournaments from Monad...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          {tournaments.length === 0
            ? 'No tournaments created yet. Check back soon!'
            : 'No tournaments match your filters.'}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <TournamentCard key={t.id} {...t} />
          ))}
        </div>
      )}
    </div>
  );
}
