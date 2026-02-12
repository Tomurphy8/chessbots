use anchor_lang::prelude::*;

#[error_code]
pub enum ChessBotsError {
    #[msg("Protocol is paused")]
    ProtocolPaused,

    #[msg("Unauthorized: signer is not the authority")]
    Unauthorized,

    #[msg("Tournament is not in registration phase")]
    NotInRegistration,

    #[msg("Tournament is full")]
    TournamentFull,

    #[msg("Registration deadline has passed")]
    RegistrationDeadlinePassed,

    #[msg("Registration deadline has not passed yet")]
    RegistrationDeadlineNotPassed,

    #[msg("Not enough players to start tournament")]
    NotEnoughPlayers,

    #[msg("Tournament is not in progress")]
    TournamentNotInProgress,

    #[msg("Tournament is not in the correct state for this action")]
    InvalidTournamentState,

    #[msg("Game is not in the correct state")]
    InvalidGameState,

    #[msg("Game result is invalid")]
    InvalidGameResult,

    #[msg("Round is still active, cannot advance")]
    RoundStillActive,

    #[msg("All rounds have been completed")]
    AllRoundsCompleted,

    #[msg("Prizes have already been distributed")]
    PrizesAlreadyDistributed,

    #[msg("Tournament is not completed")]
    TournamentNotCompleted,

    #[msg("Agent is already registered for this tournament")]
    AlreadyRegistered,

    #[msg("Agent name is too long (max 32 characters)")]
    NameTooLong,

    #[msg("Invalid tier")]
    InvalidTier,

    #[msg("Invalid player count")]
    InvalidPlayerCount,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Invalid fee configuration")]
    InvalidFeeConfig,

    #[msg("Invalid time control settings")]
    InvalidTimeControl,

    #[msg("Agent is not registered for this tournament")]
    NotRegistered,

    #[msg("Cannot cancel tournament that is in progress")]
    CannotCancelInProgress,
}
