/// Protocol fee: 10% of total prize pool (in basis points)
pub const DEFAULT_PROTOCOL_FEE_BPS: u16 = 1000;

/// 90% of protocol fee goes to buyback (in basis points)
pub const DEFAULT_BUYBACK_SHARE_BPS: u16 = 9000;

/// 10% of protocol fee goes to treasury (in basis points)
pub const DEFAULT_TREASURY_SHARE_BPS: u16 = 1000;

/// Prize distribution: 70% to 1st place (in basis points)
pub const FIRST_PLACE_BPS: u16 = 7000;

/// Prize distribution: 20% to 2nd place (in basis points)
pub const SECOND_PLACE_BPS: u16 = 2000;

/// Prize distribution: 10% to 3rd place (in basis points)
pub const THIRD_PLACE_BPS: u16 = 1000;

/// Basis point denominator
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Maximum players per tournament
pub const MAX_PLAYERS: u8 = 64;

/// Minimum players per tournament
pub const MIN_PLAYERS: u8 = 4;

/// Maximum name length
pub const MAX_NAME_LENGTH: usize = 32;

/// Maximum URI length
pub const MAX_URI_LENGTH: usize = 128;
