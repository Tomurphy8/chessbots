use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ChessBotsError;
use crate::events::TournamentCancelled;

#[derive(Accounts)]
pub struct CancelTournament<'info> {
    #[account(
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [Tournament::SEED, tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        constraint = tournament.status == TournamentStatus::Registration @ ChessBotsError::CannotCancelInProgress,
        constraint = tournament.authority == authority.key() || protocol.authority == authority.key() @ ChessBotsError::Unauthorized,
    )]
    pub tournament: Account<'info, Tournament>,

    pub authority: Signer<'info>,
}

/// Cancels a tournament that is still in registration phase.
/// Refunds are handled by a separate instruction per-agent (to avoid transaction size limits).
pub fn handler(ctx: Context<CancelTournament>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;

    tournament.status = TournamentStatus::Cancelled;

    emit!(TournamentCancelled {
        tournament_id: tournament.id,
        refund_count: tournament.registered_count,
    });

    Ok(())
}
