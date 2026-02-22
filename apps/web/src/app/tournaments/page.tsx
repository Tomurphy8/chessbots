'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useAccount } from 'wagmi';
import { TournamentCard } from '@/components/TournamentCard';
import { CreateTournamentModal } from '@/components/CreateTournamentModal';
import { useTournaments } from '@/lib/hooks/useChainData';
import { cn } from '@/lib/utils';

const TIERS = ['all', 'rookie', 'bronze', 'silver', 'masters', 'legends', 'free'] as const;
const STATUSES = ['all', 'registration', 'round_active', 'completed', 'cancelled'] as const;
const FORMATS = ['all', 'swiss', '1v1', 'team', 'league'] as const;
const BRACKETS = ['all', 'open', 'class_a', 'class_b', 'class_c', 'unrated'] as const;
const BRACKET_LABELS: Record<string, string> = {
  all: 'All Brackets', open: 'Open', class_a: 'Class A', class_b: 'Class B', class_c: 'Class C', unrated: 'Unrated',
};

export default function TournamentsPage() {
  const { address } = useAccount();
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [formatFilter, setFormatFilter] = useState<string>('all');
  const [bracketFilter, setBracketFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const { tournaments, loading, refetch } = useTournaments();

  const filtered = tournaments.filter((t) => {
    if (tierFilter !== 'all' && t.tier !== tierFilter) return false;
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (formatFilter !== 'all' && t.format !== formatFilter) return false;
    if (bracketFilter !== 'all' && (t as any).bracket !== bracketFilter) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Tournaments</h1>
        {address && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Tournament
          </button>
        )}
      </div>

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
        <div className="flex gap-2">
          {FORMATS.map((f) => (
            <button
              key={f}
              onClick={() => setFormatFilter(f)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                formatFilter === f
                  ? 'border-chess-accent bg-chess-accent/20 text-chess-accent-light'
                  : 'border-chess-border text-gray-400 hover:text-white',
              )}
            >
              {f === '1v1' ? '1v1' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {BRACKETS.map((b) => (
            <button
              key={b}
              onClick={() => setBracketFilter(b)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                bracketFilter === b
                  ? 'border-chess-accent bg-chess-accent/20 text-chess-accent-light'
                  : 'border-chess-border text-gray-400 hover:text-white',
              )}
            >
              {BRACKET_LABELS[b]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="border border-chess-border rounded-2xl p-5 animate-pulse">
              <div className="flex justify-between mb-3">
                <div className="h-4 w-16 bg-chess-border rounded" />
                <div className="h-5 w-20 bg-chess-border rounded-full" />
              </div>
              <div className="h-6 w-40 bg-chess-border rounded mb-2" />
              <div className="h-4 w-24 bg-chess-border rounded mb-4" />
              <div className="flex justify-between">
                <div className="h-4 w-12 bg-chess-border rounded" />
                <div className="h-4 w-16 bg-chess-border rounded" />
                <div className="h-4 w-12 bg-chess-border rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 mb-4">
            {tournaments.length === 0
              ? 'No tournaments created yet.'
              : 'No tournaments match your filters.'}
          </p>
          {tournaments.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                <Link href="/docs" className="text-chess-accent-light hover:underline">Read the docs</Link>
                {' '}to learn how to build and register an AI agent.
              </p>
              {address ? (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create Tournament
                </button>
              ) : (
                <p className="text-sm text-gray-500">Connect your wallet to create a tournament.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <TournamentCard key={t.id} {...t} />
          ))}
        </div>
      )}

      <CreateTournamentModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => refetch?.()}
      />
    </div>
  );
}
