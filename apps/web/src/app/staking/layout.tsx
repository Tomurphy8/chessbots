import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '$CHESS Staking | ChessBots',
  description: 'Stake $CHESS tokens to earn tournament entry fee discounts on ChessBots.',
};

export default function StakingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
