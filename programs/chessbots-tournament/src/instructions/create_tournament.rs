use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::state::{ProtocolState, Tournament, TournamentTier, TournamentStatus, TimeControl};
use crate::constants::*;
use crate::errors::ChessBotsError;
use crate::events::TournamentCreated;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateTournamentParams {
    pub tier: TournamentTier,
    pub max_players: u8,
    pub min_players: u8,
    pub start_time: i64,
    pub registration_deadline: i64,
    pub time_control: TimeControl,
}

#[derive(Accounts)]
pub struct CreateTournament<'info> {
    #[account(
        mut,
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
        constraint = !protocol.paused @ ChessBotsError::ProtocolPaused,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        init,
        payer = authority,
        space = 8 + Tournament::INIT_SPACE,
        seeds = [Tournament::SEED, protocol.total_tournaments.to_le_bytes().as_ref()],
        bump,
    )]
    pub tournament: Account<'info, Tournament>,

    /// Prize vault: PDA-owned token account holding USDC entry fees
    #[account(
        init,
        payer = authority,
        token::mint = usdc_mint,
        token::authority = tournament,
        seeds = [b"prize_vault", protocol.total_tournaments.to_le_bytes().as_ref()],
        bump,
    )]
    pub prize_vault: Account<'info, TokenAccount>,

    pub usdc_mint: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<CreateTournament>, params: CreateTournamentParams) -> Result<()> {
    require!(
        params.max_players >= MIN_PLAYERS && params.max_players <= MAX_PLAYERS,
        ChessBotsError::InvalidPlayerCount
    );
    require!(
        params.min_players >= MIN_PLAYERS && params.min_players <= params.max_players,
        ChessBotsError::InvalidPlayerCount
    );
    require!(
        params.time_control.base_time_seconds > 0,
        ChessBotsError::InvalidTimeControl
    );
    require!(
        params.registration_deadline < params.start_time,
        ChessBotsError::InvalidTimeControl
    );

    let protocol = &mut ctx.accounts.protocol;
    let tournament_id = protocol.total_tournaments;
    protocol.total_tournaments = protocol
        .total_tournaments
        .checked_add(1)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;

    let entry_fee = params.tier.entry_fee();
    let tournament = &mut ctx.accounts.tournament;

    tournament.id = tournament_id;
    tournament.authority = ctx.accounts.authority.key();
    tournament.tier = params.tier;
    tournament.entry_fee = entry_fee;
    tournament.usdc_mint = ctx.accounts.usdc_mint.key();
    tournament.prize_vault = ctx.accounts.prize_vault.key();
    tournament.status = TournamentStatus::Registration;
    tournament.max_players = params.max_players;
    tournament.min_players = params.min_players;
    tournament.registered_count = 0;
    tournament.current_round = 0;
    tournament.total_rounds = 0;
    tournament.start_time = params.start_time;
    tournament.registration_deadline = params.registration_deadline;
    tournament.time_control = params.time_control;
    tournament.results_uri = String::new();
    tournament.winners = [Pubkey::default(); 3];
    tournament.prize_distributed = false;
    tournament.bump = ctx.bumps.tournament;

    emit!(TournamentCreated {
        tournament_id,
        tier: params.tier as u8,
        entry_fee,
        max_players: params.max_players,
        start_time: params.start_time,
    });

    Ok(())
}
