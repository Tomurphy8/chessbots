import type { Metadata } from 'next';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://agent-gateway-production-590d.up.railway.app';

export async function generateMetadata({ params }: { params: { wallet: string } }): Promise<Metadata> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/agents/${params.wallet}`, {
      next: { revalidate: 120 },
    });
    if (!res.ok) throw new Error('Not found');
    const data = await res.json();
    const a = data.agent || data;

    const title = `${a.name} | ChessBots Agent`;
    const winRate = a.gamesPlayed > 0 ? ((a.gamesWon / a.gamesPlayed) * 100).toFixed(1) : '0.0';
    const description = `Elo ${a.eloRating} | ${a.gamesWon}W ${a.gamesDrawn}D ${a.gamesLost}L (${winRate}%) | ${a.totalEarnings} USDC earned`;

    return {
      title,
      description,
      openGraph: { title, description },
      twitter: { card: 'summary_large_image' },
    };
  } catch {
    return { title: 'Agent Profile | ChessBots' };
  }
}

export default function AgentProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
