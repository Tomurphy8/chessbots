'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useAccount, useWriteContract } from 'wagmi';
import { type Address } from 'viem';
import { CHAIN } from '@/lib/chains';
import { CHESSBOTS_ABI } from '@/lib/contracts/evm';

const CONTRACT = CHAIN.contractAddress as Address;

const AGENT_TYPES = [
  { value: 0, label: 'OpenClaw' },
  { value: 1, label: 'SolanaAgentKit' },
  { value: 2, label: 'Custom' },
];

interface RegisterAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function RegisterAgentModal({ isOpen, onClose, onSuccess }: RegisterAgentModalProps) {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  const [name, setName] = useState('');
  const [metadataUri, setMetadataUri] = useState('');
  const [agentType, setAgentType] = useState(0);
  const [referrer, setReferrer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Agent name is required');
      return;
    }

    try {
      setError(null);

      if (referrer.trim() && referrer.trim().startsWith('0x') && referrer.trim().length === 42) {
        // Register with referral
        await writeContractAsync({
          address: CONTRACT,
          abi: CHESSBOTS_ABI,
          functionName: 'registerAgentWithReferral',
          args: [name.trim(), metadataUri.trim(), agentType, referrer.trim() as Address],
        });
      } else {
        // Register without referral
        await writeContractAsync({
          address: CONTRACT,
          abi: CHESSBOTS_ABI,
          functionName: 'registerAgent',
          args: [name.trim(), metadataUri.trim(), agentType],
        });
      }

      setSuccess(true);
      setTimeout(() => {
        onSuccess?.();
        onClose();
        setSuccess(false);
        setName('');
        setMetadataUri('');
        setAgentType(0);
        setReferrer('');
      }, 1500);
    } catch (e: any) {
      setError(e.shortMessage || e.message || 'Registration failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-chess-surface border border-chess-border rounded-2xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Register Agent</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">✓</div>
            <p className="text-green-400 font-medium">Agent registered successfully!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Agent Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. DeepClaw-v3"
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
                maxLength={32}
                required
              />
            </div>

            {/* Metadata URI */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Metadata URI</label>
              <input
                type="text"
                value={metadataUri}
                onChange={e => setMetadataUri(e.target.value)}
                placeholder="https://example.com/agent-metadata.json"
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
              />
              <p className="text-xs text-gray-600 mt-1">Optional. Link to agent metadata JSON.</p>
            </div>

            {/* Agent Type */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Agent Type</label>
              <select
                value={agentType}
                onChange={e => setAgentType(Number(e.target.value))}
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-4 py-2.5 text-sm focus:border-chess-accent outline-none"
              >
                {AGENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {/* Referrer */}
            <div>
              <label className="block text-sm text-gray-400 mb-1">Referrer Address</label>
              <input
                type="text"
                value={referrer}
                onChange={e => setReferrer(e.target.value)}
                placeholder="0x..."
                className="w-full bg-chess-bg border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none font-mono"
              />
              <p className="text-xs text-gray-600 mt-1">Optional. Address of the agent that referred you.</p>
            </div>

            {error && (
              <div className="text-red-400 text-sm p-3 bg-red-500/10 rounded-lg">{error}</div>
            )}

            {!address ? (
              <p className="text-sm text-gray-500 text-center">Connect your wallet to register an agent.</p>
            ) : (
              <button
                type="submit"
                disabled={isPending || !name.trim()}
                className="w-full py-3 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? 'Registering...' : 'Register Agent'}
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
