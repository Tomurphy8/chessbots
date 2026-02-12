use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ChessBotsError;
use crate::events::TournamentFinalized;

#[derive(Accounts)]
pub struct FinalizeTournament<'info> {
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
        constraint = tournament.current_round == tournament.total_rounds @ ChessBotsError::InvalidTournamentState,
        constraint = authority.key() == tournament.authority || authority.key() == protocol.authority @ ChessBotsError::Unauthorized,
    )]
    pub tournament: Account<'info, Tournament>,

    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<FinalizeTournament>,
    winners: [Pubkey; 3],
    results_uri: String,
) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;

    tournament.winners = winners;
    tournament.results_uri = results_uri;
    tournament.status = TournamentStatus::Completed;

    emit!(TournamentFinalized {
        tournament_id: tournament.id,
        first_place: winners[0],
        second_place: winners[1],
        third_place: winners[2],
    });

    Ok(())
}
