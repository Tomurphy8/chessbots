use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ChessBotsError;
use crate::events::GameCreated;

#[derive(Accounts)]
#[instruction(round: u8, game_index: u8)]
pub struct CreateGame<'info> {
    #[account(
        seeds = [ProtocolState::SEED],
        bump = protocol.bump,
    )]
    pub protocol: Account<'info, ProtocolState>,

    #[account(
        seeds = [Tournament::SEED, tournament.id.to_le_bytes().as_ref()],
        bump = tournament.bump,
        constraint = tournament.status == TournamentStatus::RoundActive @ ChessBotsError::InvalidTournamentState,
        constraint = tournament.current_round == round @ ChessBotsError::InvalidTournamentState,
    )]
    pub tournament: Account<'info, Tournament>,

    #[account(
        init,
        payer = authority,
        space = 8 + Game::INIT_SPACE,
        seeds = [
            Game::SEED,
            tournament.id.to_le_bytes().as_ref(),
            &[round],
            &[game_index],
        ],
        bump,
    )]
    pub game: Account<'info, Game>,

    /// CHECK: White player's wallet (validated off-chain by orchestrator)
    pub white: UncheckedAccount<'info>,

    /// CHECK: Black player's wallet (validated off-chain by orchestrator)
    pub black: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = authority.key() == tournament.authority || authority.key() == protocol.authority @ ChessBotsError::Unauthorized,
    )]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateGame>, round: u8, game_index: u8) -> Result<()> {
    let game = &mut ctx.accounts.game;
    let tournament = &ctx.accounts.tournament;

    game.tournament = tournament.key();
    game.round = round;
    game.game_index = game_index;
    game.white = ctx.accounts.white.key();
    game.black = ctx.accounts.black.key();
    game.status = GameStatus::Pending;
    game.result = GameResult::Undecided;
    game.move_count = 0;
    game.started_at = 0;
    game.ended_at = 0;
    game.pgn_uri = String::new();
    game.result_hash = [0u8; 32];
    game.arbiter = ctx.accounts.authority.key();
    game.bump = ctx.bumps.game;

    emit!(GameCreated {
        tournament_id: tournament.id,
        round,
        game_index,
        white: game.white,
        black: game.black,
    });

    Ok(())
}
