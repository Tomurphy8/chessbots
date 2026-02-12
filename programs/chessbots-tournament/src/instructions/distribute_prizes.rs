use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::constants::*;
use crate::errors::ChessBotsError;
use crate::events::PrizesDistributed;

#[derive(Accounts)]
pub struct DistributePrizes<'info> {
    #[account(
        mut,
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        mut,
        seeds = [Tournament::SEED, tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        constraint = tournament.status == TournamentStatus::Completed @ ChessBotsError::TournamentNotCompleted,
        constraint = !tournament.prize_distributed @ ChessBotsError::PrizesAlreadyDistributed,
    )]
    pub tournament: Account<'info, Tournament>,

    /// Prize vault PDA holding all entry fees
    #[account(
        mut,
        seeds = [b"prize_vault", tournament.id.to_le_bytes().as_ref()],
        bump,
        constraint = prize_vault.key() == tournament.prize_vault,
    )]
    pub prize_vault: Account<'info, TokenAccount>,

    /// 1st place USDC token account
    #[account(
        mut,
        constraint = first_place_usdc.mint == tournament.usdc_mint,
    )]
    pub first_place_usdc: Account<'info, TokenAccount>,

    /// 2nd place USDC token account
    #[account(
        mut,
        constraint = second_place_usdc.mint == tournament.usdc_mint,
    )]
    pub second_place_usdc: Account<'info, TokenAccount>,

    /// 3rd place USDC token account
    #[account(
        mut,
        constraint = third_place_usdc.mint == tournament.usdc_mint,
    )]
    pub third_place_usdc: Account<'info, TokenAccount>,

    /// Protocol treasury USDC token account (receives 10% of protocol fee)
    #[account(
        mut,
        constraint = treasury_usdc.mint == tournament.usdc_mint,
    )]
    pub treasury_usdc: Account<'info, TokenAccount>,

    #[account(
        constraint = authority.key() == tournament.authority || authority.key() == protocol.authority @ ChessBotsError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<DistributePrizes>) -> Result<()> {
    let tournament = &ctx.accounts.tournament;
    let protocol = &ctx.accounts.protocol;

    let total_pool = tournament.total_prize_pool();

    // Calculate protocol fee (10% of total)
    let protocol_fee = total_pool
        .checked_mul(protocol.protocol_fee_bps as u64)
        .ok_or(ChessBotsError::ArithmeticOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;

    // Treasury gets 100% of protocol fee for MVP (buyback deferred)
    let treasury_amount = protocol_fee;

    // Player prizes = total - protocol fee
    let player_pool = total_pool
        .checked_sub(protocol_fee)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;

    let first_prize = player_pool
        .checked_mul(FIRST_PLACE_BPS as u64)
        .ok_or(ChessBotsError::ArithmeticOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;

    let second_prize = player_pool
        .checked_mul(SECOND_PLACE_BPS as u64)
        .ok_or(ChessBotsError::ArithmeticOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;

    // Third gets remainder to avoid dust
    let third_prize = player_pool
        .checked_sub(first_prize)
        .ok_or(ChessBotsError::ArithmeticOverflow)?
        .checked_sub(second_prize)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;

    // Build PDA signer seeds for tournament (which owns the prize vault)
    let tournament_id_bytes = tournament.id.to_le_bytes();
    let bump = &[tournament.bump];
    let signer_seeds: &[&[&[u8]]] = &[&[Tournament::SEED, tournament_id_bytes.as_ref(), bump]];

    // Transfer 1st place prize
    if first_prize > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.prize_vault.to_account_info(),
                    to: ctx.accounts.first_place_usdc.to_account_info(),
                    authority: ctx.accounts.tournament.to_account_info(),
                },
                signer_seeds,
            ),
            first_prize,
        )?;
    }

    // Transfer 2nd place prize
    if second_prize > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.prize_vault.to_account_info(),
                    to: ctx.accounts.second_place_usdc.to_account_info(),
                    authority: ctx.accounts.tournament.to_account_info(),
                },
                signer_seeds,
            ),
            second_prize,
        )?;
    }

    // Transfer 3rd place prize
    if third_prize > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.prize_vault.to_account_info(),
                    to: ctx.accounts.third_place_usdc.to_account_info(),
                    authority: ctx.accounts.tournament.to_account_info(),
                },
                signer_seeds,
            ),
            third_prize,
        )?;
    }

    // Transfer protocol fee to treasury
    if treasury_amount > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.prize_vault.to_account_info(),
                    to: ctx.accounts.treasury_usdc.to_account_info(),
                    authority: ctx.accounts.tournament.to_account_info(),
                },
                signer_seeds,
            ),
            treasury_amount,
        )?;
    }

    // Mark prizes as distributed
    let tournament = &mut ctx.accounts.tournament;
    tournament.prize_distributed = true;

    // Update protocol stats
    let protocol = &mut ctx.accounts.protocol;
    protocol.total_prize_distributed = protocol
        .total_prize_distributed
        .checked_add(player_pool)
        .ok_or(ChessBotsError::ArithmeticOverflow)?;

    emit!(PrizesDistributed {
        tournament_id: tournament.id,
        total_pool,
        first_prize,
        second_prize,
        third_prize,
        protocol_fee,
    });

    Ok(())
}
