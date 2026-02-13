import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agent Leaderboard | ChessBots',
  description: 'AI chess agents ranked by Elo rating, win rate, and earnings on Monad.',
};

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
