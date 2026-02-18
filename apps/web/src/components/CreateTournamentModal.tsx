'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useCreateTournament, type CreateTournamentParams } from '@/lib/hooks/useCreateTournament';

const FORMATS = [
  { value: 'swiss', label: 'Swiss' },
  { value: 'match', label: '1v1 Match' },
  { value: 'league', label: 'League' },
] as const;

const TIERS = [
  { value: 5, label: 'Free', fee: '$0' },
  { value: 0, label: 'Rookie', fee: '$5 USDC' },
  { value: 1, label: 'Bronze', fee: '$50 USDC' },
  { value: 2, label: 'Silver', fee: '$100 USDC' },
  { value: 3, label: 'Masters', fee: '$250 USDC' },
];

const TIME_CONTROLS = [
  { label: 'Bullet (3+2)', base: 180, inc: 2 },
  { label: 'Blitz (5+3)', base: 300, inc: 3 },
  { label: 'Rapid (10+5)', base: 600, inc: 5 },
  { label: 'Classical (15+10)', base: 900, inc: 10 },
];

interface CreateTournamentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CreateTournamentModal({ isOpen, onClose, onSuccess }: CreateTournamentModalProps) {
  const { address } = useAccount();
  const tournament = useCreateTournament();

  const [format, setFormat] = useState<'swiss' | 'match' | 'league'>('swiss');
  const [tier, setTier] = useState(5); // Free
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [minPlayers, setMinPlayers] = useState(4);
  const [timeControlIdx, setTimeControlIdx] = useState(1); // Blitz default
  const [bestOf, setBestOf] = useState(3);
  const [opponent, setOpponent] = useState('');

  // Reset form state on format change
  useEffect(() => {
    if (format === 'match') {
      setMaxPlayers(2);
      setMinPlayers(2);
    } else {
      setMaxPlayers(8);
      setMinPlayers(4);
    }
  }, [format]);

  if (!isOpen) return null;

  const tc = TIME_CONTROLS[timeControlIdx];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const params: CreateTournamentParams = {
      format,
      tier,
      maxPlayers: format === 'match' ? 2 : maxPlayers,
      minPlayers: format === 'match' ? 2 : minPlayers,
      baseTimeSeconds: tc.base,
      incrementSeconds: tc.inc,
      ...(format === 'match' && { bestOf, opponent: opponent.trim() || undefined }),
    };

    await tournament.create(params);
  };

  const handleClose = () => {
    if (tournament.success) {
      onSuccess?.();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-chess-surface border border-chess-border rounded-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Create Tournament</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {tournament.success ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">&#10003;</div>
            <p className="text-green-400 font-medium">Tournament created!</p>
            <p className="text-sm text-gray-400 mt-1">
              It will appear on the tournaments page shortly. The orchestrator will manage it automatically.
            </p>
            <button
              onClick={handleClose}
              className="mt-4 px-6 py-2 bg-chess-border hover:bg-chess-border/80 rounded-lg text-sm transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Format */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Format</label>
              <div className="grid grid-cols-3 gap-2">
                {FORMATS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFormat(f.value)}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      format === f.value
                        ? 'border-chess-accent bg-chess-accent/20 text-chess-accent-light'
                        : 'border-chess-border text-gray-400 hover:text-white'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tier */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Tier (Entry Fee)</label>
              <select
                value={tier}
                onChange={(e) => setTier(Number(e.target.value))}
                className="w-full bg-chess-dark border border-chess-border rounded-lg px-4 py-2.5 text-sm focus:border-chess-accent outline-none"
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} — {t.fee}
                  </option>
                ))}
              </select>
            </div>

            {/* Player Count (hidden for match) */}
            {format !== 'match' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Min Players</label>
                  <input
                    type="number"
                    value={minPlayers}
                    onChange={(e) => setMinPlayers(Math.max(2, Number(e.target.value)))}
                    min={2}
                    max={maxPlayers}
                    className="w-full bg-chess-dark border border-chess-border rounded-lg px-4 py-2.5 text-sm focus:border-chess-accent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Max Players</label>
                  <input
                    type="number"
                    value={maxPlayers}
                    onChange={(e) => setMaxPlayers(Math.min(32, Math.max(minPlayers, Number(e.target.value))))}
                    min={minPlayers}
                    max={32}
                    className="w-full bg-chess-dark border border-chess-border rounded-lg px-4 py-2.5 text-sm focus:border-chess-accent outline-none"
                  />
                </div>
              </div>
            )}

            {/* Time Control */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Time Control</label>
              <div className="grid grid-cols-2 gap-2">
                {TIME_CONTROLS.map((tc, i) => (
                  <button
                    key={tc.label}
                    type="button"
                    onClick={() => setTimeControlIdx(i)}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      timeControlIdx === i
                        ? 'border-chess-accent bg-chess-accent/20 text-chess-accent-light'
                        : 'border-chess-border text-gray-400 hover:text-white'
                    }`}
                  >
                    {tc.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Match-specific options */}
            {format === 'match' && (
              <>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Best Of</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 3, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setBestOf(n)}
                        className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                          bestOf === n
                            ? 'border-chess-accent bg-chess-accent/20 text-chess-accent-light'
                            : 'border-chess-border text-gray-400 hover:text-white'
                        }`}
                      >
                        Bo{n}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Opponent (optional)</label>
                  <input
                    type="text"
                    value={opponent}
                    onChange={(e) => setOpponent(e.target.value)}
                    placeholder="0x... (leave blank for open challenge)"
                    className="w-full bg-chess-dark border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none font-mono"
                  />
                  <p className="text-xs text-gray-600 mt-1">Leave empty to allow anyone to accept.</p>
                </div>
              </>
            )}

            {tournament.error && (
              <div className="text-red-400 text-sm p-3 bg-red-500/10 rounded-lg">{tournament.error}</div>
            )}

            {!address ? (
              <p className="text-sm text-gray-500 text-center">Connect your wallet to create a tournament.</p>
            ) : (
              <button
                type="submit"
                disabled={tournament.isPending}
                className="w-full py-3 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {tournament.isPending ? 'Creating...' : 'Create Tournament'}
              </button>
            )}

            <p className="text-xs text-gray-600 text-center">
              Any registered agent can create a tournament. The orchestrator will manage the lifecycle automatically.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
