'use client';

import { Flame, Coins, TrendingDown, Lock } from 'lucide-react';
import Link from 'next/link';

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
          {STAKING_TIERS.map((tier) => (
            <div key={tier.threshold} className={`border rounded-xl p-5 bg-chess-surface ${tier.color}`}>
              <div className="text-3xl font-bold mb-1">{tier.discount}</div>
              <div className="text-sm text-gray-400 mb-3">entry fee discount</div>
              <div className="text-sm font-semibold">{tier.threshold} CHESS</div>
              <div className="text-xs text-gray-500 mt-1">minimum stake</div>
            </div>
          ))}
        </div>
      </section>

      {/* Staking Interface Placeholder */}
      <section className="bg-chess-surface border border-chess-border rounded-2xl p-8 mb-12">
        <h2 className="text-xl font-bold mb-4">Your Staking Position</h2>
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <div className="text-sm text-gray-400 mb-1">Staked Balance</div>
            <div className="text-2xl font-bold">0 CHESS</div>
          </div>
          <div>
            <div className="text-sm text-gray-400 mb-1">Current Discount</div>
            <div className="text-2xl font-bold text-gray-500">None</div>
          </div>
        </div>
        <p className="text-sm text-gray-500">
          Connect your wallet to stake $CHESS and view your discount tier.
        </p>
      </section>

      {/* Tokenomics */}
      <section className="mb-12">
        <h2 className="text-xl font-bold mb-4">Token Economics</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <Coins className="w-5 h-5 text-[#836EF9]" />
              <h3 className="font-semibold">Fixed Supply</h3>
            </div>
            <div className="text-2xl font-bold mb-1">1,000,000,000</div>
            <p className="text-sm text-gray-400">Total $CHESS tokens. No minting after launch.</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-5 h-5 text-orange-400" />
              <h3 className="font-semibold">Buyback & Burn</h3>
            </div>
            <div className="text-2xl font-bold text-orange-400 mb-1">0 CHESS</div>
            <p className="text-sm text-gray-400">Total tokens burned. 90% of protocol fees buy and burn $CHESS.</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <TrendingDown className="w-5 h-5 text-green-400" />
              <h3 className="font-semibold">Pending Buyback</h3>
            </div>
            <div className="text-2xl font-bold text-green-400 mb-1">0 USDC</div>
            <p className="text-sm text-gray-400">USDC accumulated for next buyback execution.</p>
          </div>
          <div className="border border-chess-border rounded-xl p-5 bg-chess-surface">
            <div className="flex items-center gap-2 mb-3">
              <Lock className="w-5 h-5 text-[#836EF9]" />
              <h3 className="font-semibold">Total Staked</h3>
            </div>
            <div className="text-2xl font-bold text-[#836EF9] mb-1">0 CHESS</div>
            <p className="text-sm text-gray-400">Total tokens locked in staking contract.</p>
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
