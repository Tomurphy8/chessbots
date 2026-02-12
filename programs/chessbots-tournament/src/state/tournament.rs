use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum TournamentTier {
    Bronze,  // 50 USDC
    Silver,  // 100 USDC
    Masters, // 250 USDC
}

impl TournamentTier {
    /// Entry fee in USDC lamports (6 decimals)
    pub fn entry_fee(&self) -> u64 {
        match self {
            TournamentTier::Bronze => 50_000_000,   // 50 USDC
            TournamentTier::Silver => 100_000_000,  // 100 USDC
            TournamentTier::Masters => 250_000_000, // 250 USDC
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum TournamentStatus {
    Registration,
    InProgress,
    RoundActive,
    RoundComplete,
    Completed,
    Cancelled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct TimeControl {
    /// Base time in seconds (e.g., 300 for 5 min)
    pub base_time_seconds: u32,
    /// Increment per move in seconds
    pub increment_seconds: u32,
}

#[account]
#[derive(InitSpace)]
pub struct Tournament {
    /// Unique tournament ID
    pub id: u64,
    /// Tournament creator/admin
    pub authority: Pubkey,
    /// Competition tier (determines entry fee)
    pub tier: TournamentTier,
    /// Entry fee in USDC lamports (derived from tier)
    pub entry_fee: u64,
    /// USDC mint address
    pub usdc_mint: Pubkey,
    /// Prize vault PDA (holds all entry fees)
    pub prize_vault: Pubkey,
    /// Current tournament status
    pub status: TournamentStatus,
    /// Maximum players allowed
    pub max_players: u8,
    /// Minimum players to start
    pub min_players: u8,
    /// Current number of registered players
    pub registered_count: u8,
    /// Current round number (0 = not started)
    pub current_round: u8,
    /// Total rounds to play
    pub total_rounds: u8,
    /// Unix timestamp for tournament start
    pub start_time: i64,
    /// Registration deadline (unix timestamp)
    pub registration_deadline: i64,
    /// Time control settings
    pub time_control: TimeControl,
    /// Arweave URI for full tournament results
    #[max_len(128)]
    pub results_uri: String,
    /// 1st, 2nd, 3rd place wallet addresses
    pub winners: [Pubkey; 3],
    /// Whether prizes have been distributed
    pub prize_distributed: bool,
    /// PDA bump
    pub bump: u8,
}

impl Tournament {
    pub const SEED: &'static [u8] = b"tournament";

    /// Calculate total rounds for Swiss system: ceil(log2(players))
    pub fn calculate_rounds(player_count: u8) -> u8 {
        if player_count <= 1 {
            return 0;
        }
        let mut rounds = 0u8;
        let mut n = player_count - 1;
        while n > 0 {
            rounds += 1;
            n >>= 1;
        }
        rounds
    }

    /// Total prize pool = entry_fee * registered_count
    pub fn total_prize_pool(&self) -> u64 {
        self.entry_fee
            .checked_mul(self.registered_count as u64)
            .unwrap_or(0)
    }
}
