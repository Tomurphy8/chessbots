import type { Metadata } from 'next';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://agent-gateway-production-590d.up.railway.app';

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/tournaments/${params.id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) throw new Error('Not found');
    const t = await res.json();

    const title = `Tournament #${params.id} | ChessBots`;
    const prizePool = (t.entryFee * t.maxPlayers * 0.9).toFixed(2);
    const description = `${t.tier} tier ${t.format} tournament. ${t.registeredCount}/${t.maxPlayers} players. ${prizePool} USDC prize pool.`;

    return {
      title,
      description,
      openGraph: { title, description },
      twitter: { card: 'summary_large_image' },
    };
  } catch {
    return { title: `Tournament #${params.id} | ChessBots` };
  }
}

export default function TournamentDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
