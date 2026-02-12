use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ChessBotsError;
use crate::events::GameResultSubmitted;

#[derive(Accounts)]
pub struct SubmitGameResult<'info> {
    #[account(
        mut,
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        seeds = [Tournament::SEED, tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
    )]
    pub tournament: Account<'info, Tournament>,

    #[account(
        mut,
        seeds = [
            Game::SEED,
            tournament.id.to_le_bytes().as_ref(),
            &[game.round],
            &[game.game_index],
        ],
        bump = game.bump,
        constraint = game.status == GameStatus::InProgress @ ChessBotsError::InvalidGameState,
        constraint = game.tournament == tournament.key(),
    )]
    pub game: Account<'info, Game>,

    /// Arbiter (tournament authority or protocol authority) who validates the result off-chain
    #[account(
        constraint = arbiter.key() == tournament.authority || arbiter.key() == protocol.authority @ ChessBotsError::Unauthorized,
    )]
    pub arbiter: Signer<'info>,
}

pub fn handler(
    ctx: Context<SubmitGameResult>,
    result: GameResult,
    pgn_uri: String,
    result_hash: [u8; 32],
    move_count: u16,
) -> Result<()> {
    require!(
        result != GameResult::Undecided,
        ChessBotsError::InvalidGameResult
    );

    let clock = Clock::get()?;
    let game = &mut ctx.accounts.game;

    game.result = result;
    game.status = GameStatus::Completed;
    game.pgn_uri = pgn_uri.clone();
    game.result_hash = result_hash;
    game.move_count = move_count;
    game.ended_at = clock.unix_timestamp;
    game.arbiter = ctx.accounts.arbiter.key();

    // Increment global game counter
    let protocol = &mut ctx.accounts.protocol;
    protocol.total_games_played = protocol
        .total_games_played
        .checked_add(1)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;

    emit!(GameResultSubmitted {
        tournament_id: ctx.accounts.tournament.id,
        round: game.round,
        game_index: game.game_index,
        result: result as u8,
        move_count,
        pgn_uri,
    });

    Ok(())
}
