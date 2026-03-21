use anchor_lang::prelude::*;

#[account]
pub struct IdentityState {
    /// The user's wallet pubkey
    pub owner: Pubkey,
    /// When the identity was first minted
    pub creation_timestamp: i64,
    /// Most recent successful verification
    pub last_verification_timestamp: i64,
    /// Total successful verifications
    pub verification_count: u32,
    /// Computed reputation metric
    pub trust_score: u16,
    /// Latest Poseidon commitment H_TBH
    pub current_commitment: [u8; 32],
    /// The NonTransferable mint associated with this identity
    pub mint: Pubkey,
    /// PDA bump seed
    pub bump: u8,
    /// Timestamps of last 10 verifications (newest at index 0).
    /// Used by the registry to compute progressive trust scores.
    pub recent_timestamps: [i64; 10],
}

impl IdentityState {
    pub const LEN: usize = 8  // discriminator
        + 32  // owner
        + 8   // creation_timestamp
        + 8   // last_verification_timestamp
        + 4   // verification_count
        + 2   // trust_score
        + 32  // current_commitment
        + 32  // mint
        + 1   // bump
        + 80; // recent_timestamps (10 × 8 bytes)
}
