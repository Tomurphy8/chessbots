import type { Strategy, StrategyName, TournamentInfo, AgentState } from '../types.js';

/** Enter every free and rookie tournament */
const grinder: Strategy = {
  name: 'grinder',
  shouldEnter(tournament: TournamentInfo, _state: AgentState): boolean {
    return tournament.tier === 'free' || tournament.tier === 'rookie';
  },
};

/** Enter tournaments with soft fields (< 70% capacity) */
const value: Strategy = {
  name: 'value',
  shouldEnter(tournament: TournamentInfo, state: AgentState): boolean {
    const fillRate = tournament.registeredCount / tournament.maxPlayers;
    if (fillRate >= 0.7) return false;
    // Skip if entry fee exceeds 20% of balance
    if (tournament.entryFee > state.usdcBalance * 0.2 * 1e6) return false;
    return true;
  },
};

/** Only enter satellite tournaments — zero USDC risk */
const climber: Strategy = {
  name: 'climber',
  shouldEnter(tournament: TournamentInfo, _state: AgentState): boolean {
    return tournament.tier === 'free' || tournament.entryFee === 0;
  },
};

/** Enter everything at bracket level + Open */
const whale: Strategy = {
  name: 'whale',
  shouldEnter(tournament: TournamentInfo, state: AgentState): boolean {
    // Enter if we can afford it
    return tournament.entryFee <= state.usdcBalance * 1e6;
  },
};

const strategies: Record<StrategyName, Strategy> = {
  grinder,
  value,
  climber,
  whale,
};

export function getStrategy(name: StrategyName): Strategy {
  return strategies[name] || grinder;
}
