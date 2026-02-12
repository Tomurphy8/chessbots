use anchor_lang::prelude::*;
use crate::state::ProtocolState;
use crate::constants::*;
use crate::errors::ChessBotsError;
use crate::events::ProtocolInitialized;

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitProtocolParams {
    pub treasury: Pubkey,
    pub protocol_fee_bps: u16,
    pub buyback_share_bps: u16,
    pub treasury_share_bps: u16,
}

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + ProtocolState::INIT_SPACE,
        seeds = [ProtocolState::SEED],
        bump,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeProtocol>, params: InitProtocolParams) -> Result<()> {
    require!(
        params.buyback_share_bps + params.treasury_share_bps == BPS_DENOMINATOR as u16,
        ChessBotsError::InvalidFeeConfig
    );

    let protocol = &mut ctx.accounts.protocol;
    protocol.authority = ctx.accounts.authority.key();
    protocol.treasury = params.treasury;
    protocol.protocol_fee_bps = params.protocol_fee_bps;
    protocol.buyback_share_bps = params.buyback_share_bps;
    protocol.treasury_share_bps = params.treasury_share_bps;
    protocol.total_tournaments = 0;
    protocol.total_games_played = 0;
    protocol.total_prize_distributed = 0;
    protocol.paused = false;
    protocol.bump = ctx.bumps.protocol;

    emit!(ProtocolInitialized {
        authority: protocol.authority,
        treasury: protocol.treasury,
        protocol_fee_bps: protocol.protocol_fee_bps,
    });

    Ok(())
}
