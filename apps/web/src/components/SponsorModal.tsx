'use client';

import { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { useAccount, useWriteContract } from 'wagmi';
import { parseUnits, type Address } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI } from '@/lib/contracts/evm';
import { useUsdcApproval } from '@/lib/hooks/useUsdcApproval';

const CONTRACT = CHAIN.contractAddress as Address;

interface SponsorModalProps {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: number;
  onSuccess?: () => void;
}

export function SponsorModal({ isOpen, onClose, tournamentId, onSuccess }: SponsorModalProps) {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  const [amount, setAmount] = useState('');
  const [sponsorName, setSponsorName] = useState('');
  const [sponsorUri, setSponsorUri] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // USDC approval for the contract
  const approval = useUsdcApproval(CHAIN.contractAddress, amount || '0');

  if (!isOpen) return null;

  const handleApprove = async () => {
    try {
      setError(null);
      await approval.approve(amount);
    } catch (e: any) {
      setError(e.shortMessage || e.message || 'Approval failed');
    }
  };

  const handleSponsor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) {
      setError('Amount must be greater than 0');
      return;
    }
    if (!sponsorName.trim()) {
      setError('Sponsor name is required');
      return;
    }

    try {
      setError(null);
      const parsedAmount = parseUnits(amount, 6); // USDC 6 decimals

      await writeContractAsync({
        address: CONTRACT,
        abi: CHESSBOTS_ABI,
        functionName: 'sponsorTournament',
        args: [BigInt(tournamentId), parsedAmount, sponsorName.trim(), sponsorUri.trim()],
      });

      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        onClose();
        setSuccess(false);
        setAmount('');
        setSponsorName('');
        setSponsorUri('');
      }, 1500);
    } catch (e: any) {
      setError(e.shortMessage || e.message || 'Sponsorship failed');
    }
  };

  const needsApproval = parseFloat(amount || '0') > 0 && approval.needsApproval;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-chess-surface border border-chess-border rounded-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Sponsor Tournament #{tournamentId}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">🎉</div>
            <p className="text-green-400 font-medium">Sponsorship successful!</p>
            <p className="text-sm text-gray-400 mt-1">Your brand will appear on the tournament page.</p>
          </div>
        ) : (
          <form onSubmit={handleSponsor} className="space-y-4">
            {/* Amount */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Sponsorship Amount (USDC) *</label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="100.00"
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
                min="0"
                step="any"
                required
              />
              <p className="text-xs text-gray-600 mt-1">USDC contributed to the tournament prize pool.</p>
            </div>

            {/* Sponsor Name */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Sponsor Name *</label>
              <input
                type="text"
                value={sponsorName}
                onChange={e => setSponsorName(e.target.value)}
                placeholder="Your brand or company name"
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
                maxLength={64}
                required
              />
            </div>

            {/* Sponsor URI */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Logo or Website URL</label>
              <input
                type="text"
                value={sponsorUri}
                onChange={e => setSponsorUri(e.target.value)}
                placeholder="https://yourbrand.com or image URL"
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
              />
              <p className="text-xs text-gray-600 mt-1">Optional. Link to your website or brand logo.</p>
            </div>

            {error && (
              <div className="text-red-400 text-sm p-3 bg-red-500/10 rounded-lg">{error}</div>
            )}

            {!address ? (
              <p className="text-sm text-gray-500 text-center">Connect your wallet to sponsor this tournament.</p>
            ) : needsApproval ? (
              <button
                type="button"
                onClick={handleApprove}
                disabled={approval.isPending}
                className="w-full py-3 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {approval.isPending ? 'Approving...' : `Approve ${amount} USDC`}
              </button>
            ) : (
              <button
                type="submit"
                disabled={isPending || !amount || !sponsorName.trim()}
                className="w-full py-3 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? 'Sponsoring...' : 'Sponsor Tournament'}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
