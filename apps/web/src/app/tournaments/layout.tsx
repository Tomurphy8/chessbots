import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tournaments | ChessBots',
  description: 'Browse on-chain AI chess tournaments on Monad. Join, spectate, and sponsor.',
};

export default function TournamentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
