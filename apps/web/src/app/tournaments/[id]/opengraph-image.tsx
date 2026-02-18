import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'ChessBots Tournament';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://agent-gateway-production-590d.up.railway.app';

const TIER_COLORS: Record<string, string> = {
  rookie: '#4ade80',
  bronze: '#d97706',
  silver: '#94a3b8',
  masters: '#fbbf24',
  legends: '#f87171',
  free: '#22d3ee',
};

export default async function Image({ params }: { params: { id: string } }) {
  let tier = 'Unknown';
  let format = 'Swiss';
  let playerCount = '?';
  let maxPlayers = '?';
  let prizePool = '0.00';
  let status = 'Unknown';

  try {
    const res = await fetch(`${GATEWAY_URL}/api/tournaments/${params.id}`, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const t = await res.json();
      tier = t.tier || 'Unknown';
      format = t.format || 'Swiss';
      playerCount = String(t.registeredCount ?? '?');
      maxPlayers = String(t.maxPlayers ?? '?');
      prizePool = (t.entryFee * t.maxPlayers * 0.9).toFixed(2);
      status = t.status || 'Unknown';
    }
  } catch { /* fallback to defaults */ }

  const tierColor = TIER_COLORS[tier.toLowerCase()] || '#a78bfa';

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

        {/* Tournament title */}
        <div style={{ fontSize: 52, fontWeight: 'bold', color: '#e2e8f0', marginBottom: 16 }}>
          Tournament #{params.id}
        </div>

        {/* Tier and format */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 40 }}>
          <span
            style={{
              padding: '8px 24px',
              borderRadius: 12,
              background: `${tierColor}20`,
              color: tierColor,
              fontSize: 22,
              fontWeight: 'bold',
              textTransform: 'uppercase',
            }}
          >
            {tier}
          </span>
          <span
            style={{
              padding: '8px 24px',
              borderRadius: 12,
              background: '#1e1e2e',
              color: '#94a3b8',
              fontSize: 22,
            }}
          >
            {format}
          </span>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 64, marginTop: 'auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 16, color: '#64748b', marginBottom: 4 }}>Prize Pool</span>
            <span style={{ fontSize: 36, fontWeight: 'bold', color: '#fbbf24' }}>
              {prizePool} USDC
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 16, color: '#64748b', marginBottom: 4 }}>Players</span>
            <span style={{ fontSize: 36, fontWeight: 'bold', color: '#e2e8f0' }}>
              {playerCount}/{maxPlayers}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 16, color: '#64748b', marginBottom: 4 }}>Status</span>
            <span
              style={{
                fontSize: 36,
                fontWeight: 'bold',
                color: '#e2e8f0',
                textTransform: 'capitalize',
              }}
            >
              {status.replace('_', ' ')}
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
