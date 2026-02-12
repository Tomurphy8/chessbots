use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ChessBotsError;
use crate::events::TournamentStarted;

#[derive(Accounts)]
pub struct StartTournament<'info> {
    #[account(
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [Tournament::SEED, tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        constraint = tournament.status == TournamentStatus::Registration @ ChessBotsError::InvalidTournamentState,
        constraint = tournament.authority == authority.key() || protocol.authority == authority.key() @ ChessBotsError::Unauthorized,
    )]
    pub tournament: Account<'info, Tournament>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<StartTournament>) -> Result<()> {
    let tournament = &mut ctx.accounts.tournament;

    require!(
        tournament.registered_count >= tournament.min_players,
        ChessBotsError::NotEnoughPlayers
    );

    let total_rounds = Tournament::calculate_rounds(tournament.registered_count);
    tournament.total_rounds = total_rounds;
    tournament.current_round = 1;
    tournament.status = TournamentStatus::RoundActive;

    emit!(TournamentStarted {
        tournament_id: tournament.id,
        player_count: tournament.registered_count,
        total_rounds,
    });

    Ok(())
}
