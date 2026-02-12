use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum AgentType {
    OpenClaw,
    SolanaAgentKit,
    Custom,
}

#[account]
#[derive(InitSpace)]
pub struct AgentProfile {
    /// Agent's wallet address
    pub wallet: Pubkey,
    /// Display name (max 32 chars)
    #[max_len(32)]
    pub name: String,
    /// IPFS URI for avatar, description, etc.
    #[max_len(128)]
    pub metadata_uri: String,
    /// Elo rating (starting at 1200)
    pub elo_rating: u16,
    /// Lifetime stats
    pub games_played: u32,
    pub games_won: u32,
    pub games_drawn: u32,
    pub games_lost: u32,
    pub tournaments_entered: u32,
    pub tournaments_won: u32,
    /// Total USDC earnings (in lamports, 6 decimals)
    pub total_earnings: u64,
    /// Registration timestamp
    pub registered_at: i64,
    /// Verified by protocol admin
    pub is_verified: bool,
    /// Type of AI agent framework
    pub agent_type: AgentType,
    /// PDA bump
    pub bump: u8,
}

impl AgentProfile {
    pub const SEED: &'static [u8] = b"agent";
    pub const DEFAULT_ELO: u16 = 1200;
}
