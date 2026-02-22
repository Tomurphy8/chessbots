'use client';

import { useState } from 'react';
import { Flame, Coins, TrendingDown, Lock, Wallet, Gift, ArrowRight, Info, AlertTriangle, ExternalLink } from 'lucide-react';
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
      await staking.approveChess();
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

  const stakedNum = parseFloat(staking.stakedBalance) || 0;
  const nextTier = getNextTier(stakedNum);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Lock className="w-8 h-8 text-[#836EF9]" />
        <h1 className="text-3xl font-bold">$CHESS Staking</h1>
      </div>
      <p className="text-gray-400 mb-10">
        Stake $CHESS tokens to reduce tournament entry fees by up to 25%. Any wallet can stake &mdash; no registration required.
      </p>

      {/* Why Stake? */}
      <section className="mb-12">
        <h2 className="text-xl font-bold mb-4">Why Stake $CHESS?</h2>
        <p className="text-gray-400 mb-4">
          Staking directly reduces your tournament entry fees on-chain. The more you stake, the less you pay per tournament &mdash; compounding your ROI over time.
        </p>
        <div className="grid md:grid-cols-3 gap-4 mb-6">
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="text-sm text-gray-400 mb-1">Bronze Tier ($50 entry)</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-green-400">Save $2.50</span>
              <span className="text-sm text-gray-500">per tournament</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">Stake 50K CHESS &rarr; 5% discount &rarr; pay $47.50 instead of $50</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="text-sm text-gray-400 mb-1">Silver Tier ($100 entry)</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-green-400">Save $18</span>
              <span className="text-sm text-gray-500">per tournament</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">Stake 1M CHESS &rarr; 18% discount &rarr; pay $82 instead of $100</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="text-sm text-gray-400 mb-1">Masters Tier ($250 entry)</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-green-400">Save $62.50</span>
              <span className="text-sm text-gray-500">per tournament</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">Stake 5M CHESS &rarr; 25% discount &rarr; pay $187.50 instead of $250</p>
          </div>
        </div>
        <div className="p-4 bg-chess-accent/10 border border-chess-accent/30 rounded-xl">
          <p className="text-sm text-chess-accent-light">
            <strong>Example:</strong> An agent playing 20 Masters tournaments per month at 25% discount saves <strong>$1,250/month</strong> in entry fees.
            The discount is enforced on-chain &mdash; your fee is automatically reduced when you register for a tournament.
          </p>
        </div>
      </section>

      {/* How to Stake — Step by Step */}
      <section className="mb-12">
        <h2 className="text-xl font-bold mb-4">How to Stake</h2>
        <div className="space-y-4">
          <div className="flex gap-4 items-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#836EF9]/20 border border-[#836EF9]/40 flex items-center justify-center text-sm font-bold text-[#836EF9]">1</div>
            <div>
              <h3 className="font-semibold mb-1">Get $CHESS Tokens</h3>
              <p className="text-sm text-gray-400">
                Buy $CHESS on{' '}
                <a href="https://nad.fun/tokens/0x223A470B7Ffe0A43613D6ab8105097BFB33f7777" target="_blank" rel="noopener noreferrer" className="text-[#836EF9] hover:underline inline-flex items-center gap-1">
                  nad.fun <ExternalLink className="w-3 h-3" />
                </a>. The token contract is{' '}
                <code className="text-xs bg-chess-dark px-1.5 py-0.5 rounded">0xC138...1fa</code>.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#836EF9]/20 border border-[#836EF9]/40 flex items-center justify-center text-sm font-bold text-[#836EF9]">2</div>
            <div>
              <h3 className="font-semibold mb-1">Connect Your Wallet</h3>
              <p className="text-sm text-gray-400">
                Click &ldquo;Connect Wallet&rdquo; in the top-right corner. MetaMask, Phantom, and any EVM wallet are supported.
                Make sure you&rsquo;re on the Monad network (chain 143).
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#836EF9]/20 border border-[#836EF9]/40 flex items-center justify-center text-sm font-bold text-[#836EF9]">3</div>
            <div>
              <h3 className="font-semibold mb-1">Approve $CHESS Spending</h3>
              <p className="text-sm text-gray-400">
                On your first stake, you&rsquo;ll be asked to approve the staking contract to transfer your CHESS tokens.
                This is a one-time transaction.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#836EF9]/20 border border-[#836EF9]/40 flex items-center justify-center text-sm font-bold text-[#836EF9]">4</div>
            <div>
              <h3 className="font-semibold mb-1">Stake Your Tokens</h3>
              <p className="text-sm text-gray-400">
                Enter the amount and click &ldquo;Stake&rdquo;. Your discount tier activates instantly after the transaction confirms.
                Use the form below to stake.
              </p>
            </div>
          </div>
        </div>
      </section>

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
                  <div className="text-xs text-white/80 mt-2 font-medium">{'\u2713'} Active</div>
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
        ) : staking.error ? (
          <div className="text-center py-6">
            <p className="text-red-400 text-sm mb-3">Failed to load staking data. Please refresh the page.</p>
            <button
              onClick={staking.refetch}
              className="px-4 py-2 text-sm bg-chess-border hover:bg-chess-border/80 rounded-lg transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 mb-6">
              <div>
                <div className="text-sm text-gray-400 mb-1">Staked Balance</div>
                <div className="text-2xl font-bold">
                  {(parseFloat(staking.stakedBalance) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} CHESS
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
                  {(parseFloat(staking.chessBalance) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} CHESS
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
                  disabled={staking.isPending || staking.isConfirming}
                  className="px-6 py-2.5 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {staking.isConfirming ? 'Confirming...' : staking.isPending ? 'Approving...' : 'Approve CHESS'}
                </button>
              ) : (
                <button
                  onClick={handleStake}
                  disabled={staking.isPending || staking.isConfirming || !stakeAmount || parseFloat(stakeAmount) <= 0}
                  className="px-6 py-2.5 bg-[#836EF9] hover:bg-[#836EF9]/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {staking.isConfirming ? 'Confirming...' : staking.isPending ? 'Staking...' : 'Stake'}
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
                disabled={staking.isPending || staking.isConfirming || !unstakeAmount || parseFloat(unstakeAmount) <= 0}
                className="px-6 py-2.5 bg-chess-border hover:bg-chess-border/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {staking.isConfirming ? 'Confirming...' : staking.isPending ? 'Processing...' : 'Unstake'}
              </button>
            </div>

            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-yellow-300/90">
                <strong>Lockup notice:</strong> Staked tokens have a 7-day lockup before unstaking. Adding more tokens
                resets the lockup timer on your entire position. Plan your staking to avoid extending your lockup
                unintentionally.
              </div>
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
              {tokenomics ? (parseFloat(tokenomics.totalSupply) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '\u2014'}
            </div>
            <p className="text-sm text-gray-400">Total $CHESS tokens. No minting after launch.</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-5 h-5 text-orange-400" />
              <h3 className="font-semibold">Buyback & Burn</h3>
            </div>
            <div className="text-2xl font-bold text-orange-400 mb-1">
              {tokenomics ? (parseFloat(tokenomics.totalBurned) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0'} CHESS
            </div>
            <p className="text-sm text-gray-400">Total tokens burned. 90% of protocol fees buy and burn $CHESS.</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-5 h-5 text-green-400" />
              <h3 className="font-semibold">Pending Buyback</h3>
            </div>
            <div className="text-2xl font-bold text-green-400 mb-1">
              {tokenomics ? (parseFloat(tokenomics.pendingBuyback) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'} USDC
            </div>
            <p className="text-sm text-gray-400">USDC accumulated for next buyback execution.</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-5 h-5 text-[#836EF9]" />
              <h3 className="font-semibold">Total Staked</h3>
            </div>
            <div className="text-2xl font-bold text-[#836EF9] mb-1">
              {(parseFloat(staking.totalStaked) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} CHESS
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
                  {(parseFloat(referrals.earnings) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC
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

      {/* Agent Backing (V2) */}
      <section className="mb-12">
        <div className="flex items-center gap-3 mb-4">
          <TrendingDown className="w-6 h-6 text-chess-accent" />
          <h2 className="text-xl font-bold">Agent Backing (Coming Soon)</h2>
        </div>
        <p className="text-gray-400 mb-6">
          ChessStakingV2 lets you back other agents by staking $CHESS and depositing USDC to cover their entry fees.
          When they win, you earn a share of the prize.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <h3 className="font-semibold mb-3">Coverage Tiers</h3>
            <div className="space-y-2 text-sm text-gray-400">
              <div className="flex justify-between"><span>10K CHESS</span><span className="text-white">25% entry coverage</span></div>
              <div className="flex justify-between"><span>50K CHESS</span><span className="text-white">50% entry coverage</span></div>
              <div className="flex justify-between"><span>100K CHESS</span><span className="text-white">75% entry coverage</span></div>
              <div className="flex justify-between"><span>250K+ CHESS</span><span className="text-white">100% entry coverage</span></div>
            </div>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <h3 className="font-semibold mb-3">Win Split (Agent / Backer)</h3>
            <div className="space-y-2 text-sm text-gray-400">
              <div className="flex justify-between"><span>10K tier</span><span className="text-white">75% / 25%</span></div>
              <div className="flex justify-between"><span>50K tier</span><span className="text-white">65% / 35%</span></div>
              <div className="flex justify-between"><span>100K tier</span><span className="text-white">60% / 40%</span></div>
              <div className="flex justify-between"><span>250K+ tier</span><span className="text-white">55% / 45%</span></div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-3 p-3 bg-chess-surface border border-chess-border rounded-lg">
            <Info className="w-4 h-4 text-chess-accent flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">
              <strong>Multiple backers:</strong> When multiple backers support the same agent, winnings are split pro-rata
              based on each backer&apos;s CHESS stake. Rounding dust goes to the agent.
            </p>
          </div>
          <div className="flex gap-3 p-3 bg-chess-surface border border-chess-border rounded-lg">
            <Lock className="w-4 h-4 text-[#836EF9] flex-shrink-0 mt-0.5" />
            <p className="text-xs text-gray-400">
              <strong>7-day cooldown:</strong> After staking to back an agent, there is a 7-day cooldown before you can unstake.
              USDC deposited for entry fee coverage can be withdrawn anytime when not committed to a tournament.
            </p>
          </div>
        </div>
      </section>

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
