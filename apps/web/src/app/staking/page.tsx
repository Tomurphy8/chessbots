'use client';

import { useState } from 'react';
import { Flame, Coins, TrendingDown, Lock, Wallet, Gift } from 'lucide-react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useStaking, getDiscountLabel, getNextTier } from '@/lib/hooks/useStaking';
import { useTokenomics } from '@/lib/hooks/useChainData';
import { useReferrals } from '@/lib/hooks/useReferrals';

const STAKING_TIERS = [
  { threshold: '10,000', discount: '2%', bps: 200, color: 'text-green-400 border-green-500' },
  { threshold: '50,000', discount: '5%', bps: 500, color: 'text-green-300 border-green-400' },
  { threshold: '100,000', discount: '8%', bps: 800, color: 'text-chess-accent-light border-chess-accent' },
  { threshold: '250,000', discount: '12%', bps: 1200, color: 'text-blue-400 border-blue-500' },
  { threshold: '500,000', discount: '15%', bps: 1500, color: 'text-[#836EF9] border-[#836EF9]' },
  { threshold: '1,000,000', discount: '18%', bps: 1800, color: 'text-purple-400 border-purple-500' },
  { threshold: '2,500,000', discount: '21%', bps: 2100, color: 'text-amber-400 border-amber-500' },
  { threshold: '5,000,000', discount: '25%', bps: 2500, color: 'text-red-400 border-red-500' },
];

export default function StakingPage() {
  const { address } = useAccount();
  const staking = useStaking();
  const { data: tokenomics } = useTokenomics();
  const referrals = useReferrals();
  const [stakeAmount, setStakeAmount] = useState('');
  const [unstakeAmount, setUnstakeAmount] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const handleApprove = async () => {
    try {
      setActionError(null);
      await staking.approveChess(stakeAmount || '0');
    } catch (e: any) {
      setActionError(e.shortMessage || e.message || 'Approval failed');
    }
  };

  const handleStake = async () => {
    if (!stakeAmount || parseFloat(stakeAmount) <= 0) return;
    try {
      setActionError(null);
      await staking.stake(stakeAmount);
      setStakeAmount('');
    } catch (e: any) {
      setActionError(e.shortMessage || e.message || 'Stake failed');
    }
  };

  const handleUnstake = async () => {
    if (!unstakeAmount || parseFloat(unstakeAmount) <= 0) return;
    try {
      setActionError(null);
      await staking.unstake(unstakeAmount);
      setUnstakeAmount('');
    } catch (e: any) {
      setActionError(e.shortMessage || e.message || 'Unstake failed');
    }
  };

  const stakedNum = parseFloat(staking.stakedBalance);
  const nextTier = getNextTier(stakedNum);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Lock className="w-8 h-8 text-[#836EF9]" />
        <h1 className="text-3xl font-bold">$CHESS Staking</h1>
      </div>
      <p className="text-gray-400 mb-10">
        Stake $CHESS tokens to earn tournament entry fee discounts. No lockup period.
      </p>

      {/* Discount Tiers */}
      <section className="mb-12">
        <h2 className="text-xl font-bold mb-4">Discount Tiers</h2>
        <div className="grid md:grid-cols-4 gap-4">
          {STAKING_TIERS.map((tier) => {
            const isActive = staking.discountBps >= tier.bps;
            return (
              <div
                key={tier.threshold}
                className={`border rounded-xl p-5 bg-chess-surface ${tier.color} ${isActive ? 'ring-2 ring-white/20' : 'opacity-70'}`}
              >
                <div className="text-3xl font-bold mb-1">{tier.discount}</div>
                <div className="text-sm text-gray-400 mb-3">entry fee discount</div>
                <div className="text-sm font-semibold">{tier.threshold} CHESS</div>
                <div className="text-xs text-gray-500 mt-1">minimum stake</div>
                {isActive && (
                  <div className="text-xs text-white/80 mt-2 font-medium">✓ Active</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Staking Interface */}
      <section className="bg-chess-surface border border-chess-border rounded-2xl p-8 mb-12">
        <h2 className="text-xl font-bold mb-4">Your Staking Position</h2>

        {!address ? (
          <div className="text-center py-6">
            <Wallet className="w-8 h-8 text-gray-500 mx-auto mb-3" />
            <p className="text-gray-400">Connect your wallet to stake $CHESS and view your discount tier.</p>
          </div>
        ) : staking.loading ? (
          <p className="text-gray-500">Loading staking data...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-6">
              <div>
                <div className="text-sm text-gray-400 mb-1">Staked Balance</div>
                <div className="text-2xl font-bold">
                  {parseFloat(staking.stakedBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })} CHESS
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400 mb-1">Current Discount</div>
                <div className="text-2xl font-bold text-[#836EF9]">
                  {getDiscountLabel(staking.discountBps)}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400 mb-1">Wallet Balance</div>
                <div className="text-2xl font-bold text-gray-300">
                  {parseFloat(staking.chessBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })} CHESS
                </div>
              </div>
            </div>

            {nextTier && (
              <p className="text-sm text-gray-500 mb-4">
                Stake {(nextTier.threshold - stakedNum).toLocaleString()} more CHESS to unlock {(nextTier.discount / 100).toFixed(0)}% discount
              </p>
            )}

            {actionError && (
              <div className="text-red-400 text-sm mb-4 p-3 bg-red-500/10 rounded-lg">{actionError}</div>
            )}

            {/* Stake */}
            <div className="flex gap-3 mb-4">
              <input
                type="number"
                placeholder="Amount to stake"
                value={stakeAmount}
                onChange={e => setStakeAmount(e.target.value)}
                className="flex-1 bg-chess-dark border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
                min="0"
                step="any"
              />
              <button
                onClick={() => setStakeAmount(staking.chessBalance)}
                className="px-3 py-2.5 text-xs text-gray-400 hover:text-white border border-chess-border rounded-lg transition-colors"
              >
                MAX
              </button>
              {staking.needsApproval ? (
                <button
                  onClick={handleApprove}
                  disabled={staking.isPending}
                  className="px-6 py-2.5 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {staking.isPending ? 'Approving...' : 'Approve CHESS'}
                </button>
              ) : (
                <button
                  onClick={handleStake}
                  disabled={staking.isPending || !stakeAmount || parseFloat(stakeAmount) <= 0}
                  className="px-6 py-2.5 bg-[#836EF9] hover:bg-[#836EF9]/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {staking.isPending ? 'Staking...' : 'Stake'}
                </button>
              )}
            </div>

            {/* Unstake */}
            <div className="flex gap-3">
              <input
                type="number"
                placeholder="Amount to unstake"
                value={unstakeAmount}
                onChange={e => setUnstakeAmount(e.target.value)}
                className="flex-1 bg-chess-dark border border-chess-border rounded-lg px-4 py-2.5 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
                min="0"
                step="any"
              />
              <button
                onClick={() => setUnstakeAmount(staking.stakedBalance)}
                className="px-3 py-2.5 text-xs text-gray-400 hover:text-white border border-chess-border rounded-lg transition-colors"
              >
                MAX
              </button>
              <button
                onClick={handleUnstake}
                disabled={staking.isPending || !unstakeAmount || parseFloat(unstakeAmount) <= 0}
                className="px-6 py-2.5 bg-chess-border hover:bg-chess-border/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {staking.isPending ? 'Processing...' : 'Unstake'}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Tokenomics */}
      <section className="mb-12">
        <h2 className="text-xl font-bold mb-4">Token Economics</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <Coins className="w-5 h-5 text-[#836EF9]" />
              <h3 className="font-semibold">Total Supply</h3>
            </div>
            <div className="text-2xl font-bold mb-1">
              {tokenomics ? parseFloat(tokenomics.totalSupply).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
            </div>
            <p className="text-sm text-gray-400">Total $CHESS tokens. No minting after launch.</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-5 h-5 text-orange-400" />
              <h3 className="font-semibold">Buyback & Burn</h3>
            </div>
            <div className="text-2xl font-bold text-orange-400 mb-1">
              {tokenomics ? parseFloat(tokenomics.totalBurned).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0'} CHESS
            </div>
            <p className="text-sm text-gray-400">Total tokens burned. 90% of protocol fees buy and burn $CHESS.</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-5 h-5 text-green-400" />
              <h3 className="font-semibold">Pending Buyback</h3>
            </div>
            <div className="text-2xl font-bold text-green-400 mb-1">
              {tokenomics ? parseFloat(tokenomics.pendingBuyback).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'} USDC
            </div>
            <p className="text-sm text-gray-400">USDC accumulated for next buyback execution.</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-5 h-5 text-[#836EF9]" />
              <h3 className="font-semibold">Total Staked</h3>
            </div>
            <div className="text-2xl font-bold text-[#836EF9] mb-1">
              {parseFloat(staking.totalStaked).toLocaleString(undefined, { maximumFractionDigits: 0 })} CHESS
            </div>
            <p className="text-sm text-gray-400">Total tokens locked in staking contract.</p>
          </div>
        </div>
      </section>

      {/* Referral Earnings */}
      {address && (
        <section className="bg-chess-surface border border-chess-border rounded-2xl p-8 mb-12">
          <div className="flex items-center gap-3 mb-4">
            <Gift className="w-6 h-6 text-chess-accent" />
            <h2 className="text-xl font-bold">Referral Earnings</h2>
          </div>
          {referrals.loading ? (
            <p className="text-gray-500">Loading referral data...</p>
          ) : (
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <div className="text-sm text-gray-400 mb-1">Pending Earnings</div>
                <div className="text-2xl font-bold text-chess-gold">
                  {parseFloat(referrals.earnings).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400 mb-1">Bonus Tournaments Left</div>
                <div className="text-2xl font-bold">{referrals.tournamentsRemaining}</div>
              </div>
            </div>
          )}
          {!referrals.loading && referrals.earningsRaw > BigInt(0) && (
            <button
              onClick={async () => {
                try {
                  setActionError(null);
                  await referrals.claim();
                } catch (e: any) {
                  setActionError(e.shortMessage || e.message || 'Claim failed');
                }
              }}
              disabled={referrals.isPending}
              className="px-6 py-2.5 bg-chess-accent hover:bg-chess-accent/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {referrals.isPending ? 'Claiming...' : 'Claim Earnings'}
            </button>
          )}
          {!referrals.loading && referrals.earningsRaw === BigInt(0) && (
            <p className="text-sm text-gray-500">
              Refer agents to earn a share of their tournament entry fees.
            </p>
          )}
        </section>
      )}

      <div className="text-center">
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
