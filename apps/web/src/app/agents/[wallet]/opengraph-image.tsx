import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'ChessBots Agent Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://agent-gateway-production-590d.up.railway.app';

export default async function Image({ params }: { params: { wallet: string } }) {
  let name = 'Unknown Agent';
  let elo = 1200;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let gamesPlayed = 0;
  let earnings = '0.00';

  try {
    const res = await fetch(`${GATEWAY_URL}/api/agents/${params.wallet}`, {
      next: { revalidate: 120 },
    });
    if (res.ok) {
      const data = await res.json();
      const a = data.agent || data;
      name = a.name || 'Unknown Agent';
      elo = a.eloRating || 1200;
      wins = a.gamesWon || 0;
      draws = a.gamesDrawn || 0;
      losses = a.gamesLost || 0;
      gamesPlayed = a.gamesPlayed || 0;
      earnings =
        typeof a.totalEarnings === 'number'
          ? a.totalEarnings.toFixed(2)
          : String(a.totalEarnings || '0.00');
    }
  } catch { /* fallback */ }

  const winRate = gamesPlayed > 0 ? ((wins / gamesPlayed) * 100).toFixed(1) : '0.0';
  const shortWallet = `${params.wallet.slice(0, 6)}...${params.wallet.slice(-4)}`;

  return new ImageResponse(
    (
      <div
        style={{
          background: '#0a0a0f',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '60px 80px',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <span style={{ fontSize: 40 }}>&#9823;</span>
          <span style={{ fontSize: 28, color: '#a78bfa', fontWeight: 'bold' }}>ChessBots</span>
        </div>

        {/* Agent name */}
        <div style={{ fontSize: 52, fontWeight: 'bold', color: '#e2e8f0', marginBottom: 8 }}>
          {name}
        </div>
        <div style={{ fontSize: 20, color: '#64748b', marginBottom: 40 }}>{shortWallet}</div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 56, marginTop: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 16, color: '#64748b', marginBottom: 4 }}>Elo Rating</span>
            <span style={{ fontSize: 36, fontWeight: 'bold', color: '#a78bfa' }}>{elo}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 16, color: '#64748b', marginBottom: 4 }}>Record</span>
            <div style={{ display: 'flex', gap: 8, fontSize: 36, fontWeight: 'bold' }}>
              <span style={{ color: '#4ade80' }}>{wins}W</span>
              <span style={{ color: '#94a3b8' }}>{draws}D</span>
              <span style={{ color: '#f87171' }}>{losses}L</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 16, color: '#64748b', marginBottom: 4 }}>Win Rate</span>
            <span style={{ fontSize: 36, fontWeight: 'bold', color: '#e2e8f0' }}>{winRate}%</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 16, color: '#64748b', marginBottom: 4 }}>Earnings</span>
            <span style={{ fontSize: 36, fontWeight: 'bold', color: '#fbbf24' }}>
              {earnings} USDC
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
