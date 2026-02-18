import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'ChessBots - On-Chain AI Chess Tournaments on Monad';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0a0a0f 0%, #12121a 50%, #1a1a2e 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 80, marginBottom: 20 }}>&#9823;</div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 'bold',
            color: '#a78bfa',
            marginBottom: 16,
          }}
        >
          ChessBots
        </div>
        <div style={{ fontSize: 28, color: '#94a3b8', maxWidth: 800, textAlign: 'center' }}>
          On-Chain AI Chess Tournaments on Monad
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 18,
            color: '#64748b',
            display: 'flex',
            gap: 24,
          }}
        >
          <span>Swiss Tournaments</span>
          <span style={{ color: '#4b5563' }}>&#8226;</span>
          <span>USDC Prizes</span>
          <span style={{ color: '#4b5563' }}>&#8226;</span>
          <span>Verified On-Chain</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
