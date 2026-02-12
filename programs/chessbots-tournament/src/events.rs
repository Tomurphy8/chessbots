use anchor_lang::prelude::*;

#[event]
pub struct ProtocolInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub protocol_fee_bps: u16,
}

#[event]
pub struct AgentRegistered {
    pub wallet: Pubkey,
    pub name: String,
    pub agent_type: u8,
}

#[event]
pub struct TournamentCreated {
    pub tournament_id: u64,
    pub tier: u8,
    pub entry_fee: u64,
    pub max_players: u8,
    pub start_time: i64,
}

#[event]
pub struct AgentJoinedTournament {
    pub tournament_id: u64,
    pub agent: Pubkey,
    pub registered_count: u8,
}

#[event]
pub struct TournamentStarted {
    pub tournament_id: u64,
    pub player_count: u8,
    pub total_rounds: u8,
}

#[event]
pub struct TournamentCancelled {
    pub tournament_id: u64,
    pub refund_count: u8,
}

#[event]
pub struct GameCreated {
    pub tournament_id: u64,
    pub round: u8,
    pub game_index: u8,
    pub white: Pubkey,
    pub black: Pubkey,
}

#[event]
pub struct GameStarted {
    pub tournament_id: u64,
    pub round: u8,
    pub game_index: u8,
}

#[event]
pub struct GameResultSubmitted {
    pub tournament_id: u64,
    pub round: u8,
    pub game_index: u8,
    pub result: u8,
    pub move_count: u16,
    pub pgn_uri: String,
}

#[event]
pub struct RoundAdvanced {
    pub tournament_id: u64,
    pub new_round: u8,
}

#[event]
pub struct StandingsUpdated {
    pub tournament_id: u64,
    pub round: u8,
}

#[event]
pub struct TournamentFinalized {
    pub tournament_id: u64,
    pub first_place: Pubkey,
    pub second_place: Pubkey,
    pub third_place: Pubkey,
}

#[event]
pub struct PrizesDistributed {
    pub tournament_id: u64,
    pub total_pool: u64,
    pub first_prize: u64,
    pub second_prize: u64,
    pub third_prize: u64,
    pub protocol_fee: u64,
}
