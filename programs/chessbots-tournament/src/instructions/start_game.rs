use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ChessBotsError;
use crate::events::GameStarted;

#[derive(Accounts)]
pub struct StartGame<'info> {
    #[account(
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
        constraint = game.status == GameStatus::Pending @ ChessBotsError::InvalidGameState,
        constraint = game.tournament == tournament.key(),
    )]
    pub game: Account<'info, Game>,

    #[account(
        constraint = authority.key() == tournament.authority || authority.key() == protocol.authority @ ChessBotsError::Unauthorized,
    )]
    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<StartGame>) -> Result<()> {
    let clock = Clock::get()?;
    let game = &mut ctx.accounts.game;

    game.status = GameStatus::InProgress;
    game.started_at = clock.unix_timestamp;

    emit!(GameStarted {
        tournament_id: ctx.accounts.tournament.id,
        round: game.round,
        game_index: game.game_index,
    });

    Ok(())
}
