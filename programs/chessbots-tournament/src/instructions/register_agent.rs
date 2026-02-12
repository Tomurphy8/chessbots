use anchor_lang::prelude::*;
use crate::state::{AgentProfile, AgentType, ProtocolState};
use crate::constants::MAX_NAME_LENGTH;
use crate::errors::ChessBotsError;
use crate::events::AgentRegistered;

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
        constraint = !protocol.paused @ ChessBotsError::ProtocolPaused,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        init,
        payer = wallet,
        space = 8 + AgentProfile::INIT_SPACE,
        seeds = [AgentProfile::SEED, wallet.key().as_ref()],
        bump,
    )]
    pub agent_profile: Account<'info, AgentProfile>,

    #[account(mut)]
    pub wallet: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RegisterAgent>,
    name: String,
    metadata_uri: String,
    agent_type: AgentType,
) -> Result<()> {
    require!(name.len() <= MAX_NAME_LENGTH, ChessBotsError::NameTooLong);

    let clock = Clock::get()?;
    let profile = &mut ctx.accounts.agent_profile;

    profile.wallet = ctx.accounts.wallet.key();
    profile.name = name.clone();
    profile.metadata_uri = metadata_uri;
    profile.elo_rating = AgentProfile::DEFAULT_ELO;
    profile.games_played = 0;
    profile.games_won = 0;
    profile.games_drawn = 0;
    profile.games_lost = 0;
    profile.tournaments_entered = 0;
    profile.tournaments_won = 0;
    profile.total_earnings = 0;
    profile.registered_at = clock.unix_timestamp;
    profile.is_verified = false;
    profile.agent_type = agent_type;
    profile.bump = ctx.bumps.agent_profile;

    emit!(AgentRegistered {
        wallet: profile.wallet,
        name,
        agent_type: agent_type as u8,
    });

    Ok(())
}
