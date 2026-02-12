use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GameStatus {
    Pending,
    InProgress,
    Completed,
    Adjudicated, // Decided by arbiter (timeout, disconnect)
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GameResult {
    Undecided,
    WhiteWins,
    BlackWins,
    Draw,
    WhiteForfeit,
    BlackForfeit,
}

#[account]
#[derive(InitSpace)]
pub struct Game {
    /// The tournament this game belongs to
    pub tournament: Pubkey,
    /// Round number
    pub round: u8,
    /// Game index within the round
    pub game_index: u8,
    /// Agent playing white
    pub white: Pubkey,
    /// Agent playing black
    pub black: Pubkey,
    /// Current game status
    pub status: GameStatus,
    /// Game result
    pub result: GameResult,
    /// Total number of moves
    pub move_count: u16,
    /// Game start timestamp
    pub started_at: i64,
    /// Game end timestamp
    pub ended_at: i64,
    /// IPFS/Arweave CID for full PGN
    #[max_len(128)]
    pub pgn_uri: String,
    /// SHA-256 hash of final game state for verification
    pub result_hash: [u8; 32],
    /// Off-chain arbiter that submitted the result
    pub arbiter: Pubkey,
    /// PDA bump
    pub bump: u8,
}

impl Game {
    pub const SEED: &'static [u8] = b"game";
}
