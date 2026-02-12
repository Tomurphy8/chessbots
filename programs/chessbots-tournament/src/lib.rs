use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("AwPehhpvVJ6Vt3T6iBzVNpnY1r4Ld2WwhUtehhqKuJz6");

#[program]
pub mod chessbots_tournament {
    use super::*;

    /// Initialize the protocol singleton with fee configuration
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        params: InitProtocolParams,
    ) -> Result<()> {
        instructions::initialize_protocol::handler(ctx, params)
    }

    /// Register a new AI agent profile on-chain
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        name: String,
        metadata_uri: String,
        agent_type: AgentType,
    ) -> Result<()> {
        instructions::register_agent::handler(ctx, name, metadata_uri, agent_type)
    }

    /// Create a new tournament with tier, player limits, and time control
    pub fn create_tournament(
        ctx: Context<CreateTournament>,
        params: CreateTournamentParams,
    ) -> Result<()> {
        instructions::create_tournament::handler(ctx, params)
    }

    /// Register an agent for a tournament (pays entry fee in USDC)
    pub fn register_for_tournament(ctx: Context<RegisterForTournament>) -> Result<()> {
        instructions::register_for_tournament::handler(ctx)
    }

    /// Start a tournament (moves from Registration to InProgress)
    pub fn start_tournament(ctx: Context<StartTournament>) -> Result<()> {
        instructions::start_tournament::handler(ctx)
    }

    /// Cancel a tournament in registration phase
    pub fn cancel_tournament(ctx: Context<CancelTournament>) -> Result<()> {
        instructions::cancel_tournament::handler(ctx)
    }

    /// Create a game between two agents in the current round
    pub fn create_game(
        ctx: Context<CreateGame>,
        round: u8,
        game_index: u8,
    ) -> Result<()> {
        instructions::create_game::handler(ctx, round, game_index)
    }

    /// Start a game (marks it as InProgress)
    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        instructions::start_game::handler(ctx)
    }

    /// Submit game result from the arbiter (off-chain engine)
    pub fn submit_game_result(
        ctx: Context<SubmitGameResult>,
        result: GameResult,
        pgn_uri: String,
        result_hash: [u8; 32],
        move_count: u16,
    ) -> Result<()> {
        instructions::submit_game_result::handler(ctx, result, pgn_uri, result_hash, move_count)
    }

    /// Advance to the next round
    pub fn advance_round(ctx: Context<AdvanceRound>) -> Result<()> {
        instructions::advance_round::handler(ctx)
    }

    /// Update a player's standings after a round
    pub fn update_standings(
        ctx: Context<UpdateStandings>,
        score: u16,
        buchholz: u16,
        games_played: u8,
        games_won: u8,
        games_drawn: u8,
        games_lost: u8,
    ) -> Result<()> {
        instructions::update_standings::handler(
            ctx,
            score,
            buchholz,
            games_played,
            games_won,
            games_drawn,
            games_lost,
        )
    }

    /// Finalize a completed tournament with winners
    pub fn finalize_tournament(
        ctx: Context<FinalizeTournament>,
        winners: [Pubkey; 3],
        results_uri: String,
    ) -> Result<()> {
        instructions::finalize_tournament::handler(ctx, winners, results_uri)
    }

    /// Distribute prizes to winners and protocol fee to treasury
    pub fn distribute_prizes(ctx: Context<DistributePrizes>) -> Result<()> {
        instructions::distribute_prizes::handler(ctx)
    }
}
