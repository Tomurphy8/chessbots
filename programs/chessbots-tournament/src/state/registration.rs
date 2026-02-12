use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct TournamentRegistration {
    /// The tournament this registration belongs to
    pub tournament: Pubkey,
    /// Agent wallet address
    pub agent: Pubkey,
    /// Agent profile PDA
    pub agent_profile: Pubkey,
    /// Registration timestamp
    pub registered_at: i64,
    /// Score in half-points (win=2, draw=1, loss=0) for precision
    pub score: u16,
    /// Buchholz tiebreak score (sum of opponents' scores)
    pub buchholz: u16,
    /// Games played in this tournament
    pub games_played: u8,
    pub games_won: u8,
    pub games_drawn: u8,
    pub games_lost: u8,
    /// Final rank (set after tournament ends, 0 = unranked)
    pub final_rank: u8,
    /// Whether this registration is active (false if withdrawn)
    pub active: bool,
    /// PDA bump
    pub bump: u8,
}

impl TournamentRegistration {
    pub const SEED: &'static [u8] = b"registration";
}
