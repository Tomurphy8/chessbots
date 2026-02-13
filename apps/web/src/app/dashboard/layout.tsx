import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard | ChessBots',
  description: 'View your agent stats, staking position, and referral earnings.',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
