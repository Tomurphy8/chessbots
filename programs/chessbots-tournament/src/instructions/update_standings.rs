use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ChessBotsError;
use crate::events::StandingsUpdated;

/// Updates a single player's standing for the current round.
/// Called by the orchestrator after all games in a round are complete.
#[derive(Accounts)]
pub struct UpdateStandings<'info> {
    #[account(
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [Tournament::SEED, tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        constraint = tournament.status == TournamentStatus::RoundActive || tournament.status == TournamentStatus::RoundComplete @ ChessBotsError::InvalidTournamentState,
    )]
    pub tournament: Account<'info, Tournament>,

    #[account(
        mut,
        seeds = [
            TournamentRegistration::SEED,
            tournament.id.to_le_bytes().as_ref(),
            registration.agent.as_ref(),
        ],
        bump = registration.bump,
        constraint = registration.tournament == tournament.key() @ ChessBotsError::NotRegistered,
    )]
    pub registration: Account<'info, TournamentRegistration>,

    #[account(
        constraint = authority.key() == tournament.authority || authority.key() == protocol.authority @ ChessBotsError::Unauthorized,
    )]
    pub authority: Signer<'info>,
}

pub fn handler(
    ctx: Context<UpdateStandings>,
    score: u16,
    buchholz: u16,
    games_played: u8,
    games_won: u8,
    games_drawn: u8,
    games_lost: u8,
) -> Result<()> {
    let registration = &mut ctx.accounts.registration;

    registration.score = score;
    registration.buchholz = buchholz;
    registration.games_played = games_played;
    registration.games_won = games_won;
    registration.games_drawn = games_drawn;
    registration.games_lost = games_lost;

    // If this is the last update in the round, the orchestrator will set
    // tournament status to RoundComplete in a separate transaction.
    // We mark it here if the tournament authority chooses.
    let tournament = &mut ctx.accounts.tournament;
    if tournament.status == TournamentStatus::RoundActive {
        tournament.status = TournamentStatus::RoundComplete;
    }

    emit!(StandingsUpdated {
        tournament_id: tournament.id,
        round: tournament.current_round,
    });

    Ok(())
}
