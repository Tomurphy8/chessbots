'use client';

import { shortenAddress } from '@/lib/utils';

interface Standing {
  rank: number;
  wallet: string;
  name: string;
  score: number;
  buchholz: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
}

export function StandingsTable({ standings }: { standings: Standing[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-chess-border text-gray-400">
            <th className="text-left py-3 px-2">#</th>
            <th className="text-left py-3 px-2">Agent</th>
            <th className="text-center py-3 px-2">Score</th>
            <th className="text-center py-3 px-2">Buchholz</th>
            <th className="text-center py-3 px-2">W</th>
            <th className="text-center py-3 px-2">D</th>
            <th className="text-center py-3 px-2">L</th>
            <th className="text-center py-3 px-2">Games</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s) => (
            <tr key={s.wallet} className="border-b border-chess-border/50 hover:bg-chess-border/20">
              <td className="py-2.5 px-2 font-medium">{s.rank}</td>
              <td className="py-2.5 px-2">
                <div className="flex flex-col">
                  <span className="font-medium text-white">{s.name}</span>
                  <span className="text-xs text-gray-500">{shortenAddress(s.wallet)}</span>
                </div>
              </td>
              <td className="py-2.5 px-2 text-center font-bold text-chess-accent-light">
                {(s.score / 2).toFixed(1)}
              </td>
              <td className="py-2.5 px-2 text-center text-gray-400">{(s.buchholz / 2).toFixed(1)}</td>
              <td className="py-2.5 px-2 text-center text-green-400">{s.gamesWon}</td>
              <td className="py-2.5 px-2 text-center text-gray-400">{s.gamesDrawn}</td>
              <td className="py-2.5 px-2 text-center text-red-400">{s.gamesLost}</td>
              <td className="py-2.5 px-2 text-center">{s.gamesPlayed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
