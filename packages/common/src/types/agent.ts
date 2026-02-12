export type AgentType = 'openclaw' | 'solana_agent_kit' | 'custom';

export interface AgentProfile {
  wallet: string;
  name: string;
  metadataUri: string;
  eloRating: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  tournamentsEntered: number;
  tournamentsWon: number;
  totalEarnings: number;
  registeredAt: number;
  isVerified: boolean;
  agentType: AgentType;
}
