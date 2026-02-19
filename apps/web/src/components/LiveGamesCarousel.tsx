'use client';

import Link from 'next/link';
import { Chessboard } from 'react-chessboard';
import { useActiveGames, type ActiveGame } from '@/lib/hooks/useActiveGames';
import { shortenAddress } from '@/lib/utils';

interface LiveGamesCarouselProps {
  tournamentId?: number;
}

function LiveGameCard({ game }: { game: ActiveGame }) {
  const tournamentPath = game.tournamentId != null
    ? `/tournaments/${game.tournamentId}/games/${game.gameId}`
    : '#';

  return (
    <Link href={tournamentPath} className="block shrink-0">
      <div className="w-[200px] bg-chess-surface border border-chess-border rounded-xl p-3 hover:border-chess-accent/50 transition-colors">
        <div className="relative">
          <Chessboard
            id={game.gameId}
            position={game.fen || 'start'}
            boardWidth={176}
            arePiecesDraggable={false}
            customDarkSquareStyle={{ backgroundColor: '#4a6741' }}
            customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
            animationDuration={0}
          />
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </div>
        </div>
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-white truncate max-w-[70px]" title={game.white}>
              ♔ {shortenAddress(game.white, 4)}
            </span>
            <span className="text-gray-500">vs</span>
            <span className="text-gray-300 truncate max-w-[70px]" title={game.black}>
              ♚ {shortenAddress(game.black, 4)}
            </span>
          </div>
          <div className="text-[10px] text-gray-500 text-center">
            {game.moveCount} moves
            {game.tournamentId != null && ` · T${game.tournamentId}`}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function LiveGamesCarousel({ tournamentId }: LiveGamesCarouselProps) {
  const { games, loading } = useActiveGames({ tournamentId });

  if (loading && games.length === 0) return null;
  if (games.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        <h2 className="text-lg font-semibold">Live Games</h2>
        <span className="text-xs text-gray-500">({games.length})</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-chess-border">
        {games.map(game => (
          <LiveGameCard key={game.gameId} game={game} />
        ))}
      </div>
    </div>
  );
}
