use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ChessBotsError;
use crate::events::RoundAdvanced;

#[derive(Accounts)]
pub struct AdvanceRound<'info> {
    #[account(
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [Tournament::SEED, tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        constraint = tournament.status == TournamentStatus::RoundComplete @ ChessBotsError::InvalidTournamentState,
        constraint = authority.key() == tournament.authority || authority.key() == protocol.authority @ ChessBotsError::Unauthorized,
    )]
    pub tournament: Account<'info, Tournament>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<AdvanceRound>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;

    require!(
        tournament.current_round < tournament.total_rounds,
        ChessBotsError::AllRoundsCompleted
    );

    tournament.current_round = tournament
        .current_round
        .checked_add(1)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;
    tournament.status = TournamentStatus::RoundActive;

    emit!(RoundAdvanced {
        tournament_id: tournament.id,
        new_round: tournament.current_round,
    });

    Ok(())
}
