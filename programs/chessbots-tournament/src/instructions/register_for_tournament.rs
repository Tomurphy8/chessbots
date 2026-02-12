use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::ChessBotsError;
use crate::events::AgentJoinedTournament;

#[derive(Accounts)]
pub struct RegisterForTournament<'info> {
    #[account(
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
        constraint = !protocol.paused @ ChessBotsError::ProtocolPaused,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [Tournament::SEED, tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        constraint = tournament.status == TournamentStatus::Registration @ ChessBotsError::NotInRegistration,
        constraint = tournament.registered_count < tournament.max_players @ ChessBotsError::TournamentFull,
    )]
    pub tournament: Account<'info, Tournament>,

    #[account(
        init,
        payer = agent,
        space = 8 + TournamentRegistration::INIT_SPACE,
        seeds = [
            TournamentRegistration::SEED,
            tournament.id.to_le_bytes().as_ref(),
            agent.key().as_ref(),
        ],
        bump,
    )]
    pub registration: Account<'info, TournamentRegistration>,

    #[account(
        seeds = [AgentProfile::SEED, agent.key().as_ref()],
        bump = agent_profile.bump,
    )]
    pub agent_profile: Account<'info, AgentProfile>,

    /// Agent's USDC token account (source of entry fee)
    #[account(
        mut,
        constraint = agent_usdc.mint == tournament.usdc_mint,
        constraint = agent_usdc.owner == agent.key(),
    )]
    pub agent_usdc: Account<'info, TokenAccount>,

    /// Prize vault (destination of entry fee)
    #[account(
        mut,
        seeds = [b"prize_vault", tournament.id.to_le_bytes().as_ref()],
        bump,
        constraint = prize_vault.key() == tournament.prize_vault,
    )]
    pub prize_vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub agent: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterForTournament>) -> Result<()> {
    let clock = Clock::get()?;

    require!(
        clock.unix_timestamp < ctx.accounts.tournament.registration_deadline,
        ChessBotsError::RegistrationDeadlinePassed
    );

    // Transfer entry fee from agent to prize vault
    let transfer_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.agent_usdc.to_account_info(),
            to: ctx.accounts.prize_vault.to_account_info(),
            authority: ctx.accounts.agent.to_account_info(),
        },
    );
    token::transfer(transfer_ctx, ctx.accounts.tournament.entry_fee)?;

    // Initialize registration
    let registration = &mut ctx.accounts.registration;
    registration.tournament = ctx.accounts.tournament.key();
    registration.agent = ctx.accounts.agent.key();
    registration.agent_profile = ctx.accounts.agent_profile.key();
    registration.registered_at = clock.unix_timestamp;
    registration.score = 0;
    registration.buchholz = 0;
    registration.games_played = 0;
    registration.games_won = 0;
    registration.games_drawn = 0;
    registration.games_lost = 0;
    registration.final_rank = 0;
    registration.active = true;
    registration.bump = ctx.bumps.registration;

    // Update tournament count
    let tournament = &mut ctx.accounts.tournament;
    tournament.registered_count = tournament
        .registered_count
        .checked_add(1)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;

    emit!(AgentJoinedTournament {
        tournament_id: tournament.id,
        agent: ctx.accounts.agent.key(),
        registered_count: tournament.registered_count,
    });

    Ok(())
}
