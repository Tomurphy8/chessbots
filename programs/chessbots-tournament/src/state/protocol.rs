use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct ProtocolState {
    /// Protocol admin (multisig in production)
    pub authority: Pubkey,
    /// Company treasury wallet for protocol revenue
    pub treasury: Pubkey,
    /// Protocol fee in basis points (1000 = 10%)
    pub protocol_fee_bps: u16,
    /// Share of protocol fee for buyback in bps (9000 = 90%)
    pub buyback_share_bps: u16,
    /// Share of protocol fee for treasury in bps (1000 = 10%)
    pub treasury_share_bps: u16,
    /// Total tournaments created
    pub total_tournaments: u64,
    /// Total games played across all tournaments
    pub total_games_played: u64,
    /// Total USDC distributed as prizes (in lamports, 6 decimals)
    pub total_prize_distributed: u64,
    /// Emergency pause
    pub paused: bool,
    /// PDA bump
    pub bump: u8,
}

impl ProtocolState {
    pub const SEED: &'static [u8] = b"protocol";
}
