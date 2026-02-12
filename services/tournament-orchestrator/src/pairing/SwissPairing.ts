import { PlayerStanding, Pairing, RoundResult } from '../types/index.js';

/**
 * Deterministic hash-based tie-breaking for Swiss pairing.
 * Uses wallet addresses as a stable, unique key to produce consistent ordering.
 */
function deterministicCompare(a: string, b: string): number {
  return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
}

export class SwissPairing {
  computePairings(standings: PlayerStanding[], round: number): RoundResult {
    const sorted = [...standings].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
      // TO-P1: Deterministic tie-breaking by wallet address (replaces Math.random)
      return deterministicCompare(a.wallet, b.wallet);
    });

    let players = [...sorted];
    let bye: string | undefined;

    if (players.length % 2 !== 0) {
      // TO-H2: Multi-bye prevention — pick the lowest-ranked player
      // who hasn't already received a bye (opponent 'BYE' in their history).
      // Fall back to the last player only if everyone has had a bye already.
      let byeIdx = -1;
      for (let i = players.length - 1; i >= 0; i--) {
        if (!players[i].opponents.includes('BYE')) {
          byeIdx = i;
          break;
        }
      }
      if (byeIdx === -1) byeIdx = players.length - 1; // All had byes, fallback
      bye = players[byeIdx].wallet;
      players = [...players.slice(0, byeIdx), ...players.slice(byeIdx + 1)];
    }

    const pairings: Pairing[] = [];
    const paired = new Set<string>();
    const scoreGroups = this.groupByScore(players);
    let gameIndex = 0;
    let unpaired: PlayerStanding[] = [];

    for (const group of scoreGroups) {
      const available = [...unpaired, ...group].filter(p => !paired.has(p.wallet));
      unpaired = [];
      if (available.length === 0) continue;

      const mid = Math.ceil(available.length / 2);
      const s1 = available.slice(0, mid);
      const s2 = available.slice(mid);

      for (let i = 0; i < Math.min(s1.length, s2.length); i++) {
        if (s1[i].opponents.includes(s2[i].wallet)) {
          // TO-H3: Try to swap with an alternative opponent to avoid repeat pairing
          let swapped = false;
          for (let j = i + 1; j < s2.length; j++) {
            if (!s1[i].opponents.includes(s2[j].wallet) && !paired.has(s2[j].wallet)) {
              [s2[i], s2[j]] = [s2[j], s2[i]];
              swapped = true;
              break;
            }
          }
          if (!swapped) {
            // No valid swap found — proceed with repeat pairing (unavoidable in small fields)
            console.warn(`[SwissPairing] Unavoidable repeat pairing: ${s1[i].wallet.slice(0, 10)} vs ${s2[i].wallet.slice(0, 10)}`);
          }
        }
        const { white, black } = this.assignColors(s1[i], s2[i]);
        pairings.push({ white, black, gameIndex });
        paired.add(s1[i].wallet);
        paired.add(s2[i].wallet);
        gameIndex++;
      }

      for (let i = s2.length; i < s1.length; i++) {
        if (!paired.has(s1[i].wallet)) unpaired.push(s1[i]);
      }
    }

    while (unpaired.length >= 2) {
      const p1 = unpaired.shift()!;
      const p2 = unpaired.shift()!;
      const { white, black } = this.assignColors(p1, p2);
      pairings.push({ white, black, gameIndex });
      gameIndex++;
    }

    if (unpaired.length === 1 && !bye) bye = unpaired[0].wallet;

    return { round, pairings, bye };
  }

  private groupByScore(players: PlayerStanding[]): PlayerStanding[][] {
    const groups = new Map<number, PlayerStanding[]>();
    for (const p of players) {
      const group = groups.get(p.score) || [];
      group.push(p);
      groups.set(p.score, group);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => b - a).map(([, g]) => g);
  }

  private assignColors(p1: PlayerStanding, p2: PlayerStanding): { white: string; black: string } {
    const p1Balance = p1.colors.filter(c => c === 'white').length - p1.colors.filter(c => c === 'black').length;
    const p2Balance = p2.colors.filter(c => c === 'white').length - p2.colors.filter(c => c === 'black').length;
    if (p1Balance < p2Balance) return { white: p1.wallet, black: p2.wallet };
    if (p2Balance < p1Balance) return { white: p2.wallet, black: p1.wallet };
    const p1Last = p1.colors[p1.colors.length - 1];
    return (p1Last === 'black' || !p1Last) ? { white: p1.wallet, black: p2.wallet } : { white: p2.wallet, black: p1.wallet };
  }

  calculateBuchholz(standings: PlayerStanding[]): void {
    const scoreMap = new Map(standings.map(p => [p.wallet, p.score]));
    for (const player of standings) {
      player.buchholz = player.opponents.reduce((sum, opp) => sum + (scoreMap.get(opp) || 0), 0);
    }
  }
}
