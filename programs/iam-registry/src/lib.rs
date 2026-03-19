#![deny(clippy::all)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;

mod errors;
mod state;

use errors::RegistryError;
use state::{ProtocolConfig, ValidatorState};

declare_id!("6VBs3zr9KrfFPGd6j7aGBPQWwZa5tajVfA7HN6MMV9VW");

#[program]
pub mod iam_registry {
    use super::*;

    /// Initialize the protocol configuration. One-time admin instruction.
    pub fn initialize_protocol(
        ctx: Context<InitializeProtocol>,
        min_stake: u64,
        challenge_expiry: i64,
        max_trust_score: u16,
        base_trust_increment: u16,
    ) -> Result<()> {
        let config = &mut ctx.accounts.protocol_config;
        config.admin = ctx.accounts.admin.key();
        config.min_stake = min_stake;
        config.challenge_expiry = challenge_expiry;
        config.max_trust_score = max_trust_score;
        config.base_trust_increment = base_trust_increment;
        config.bump = ctx.bumps.protocol_config;
        Ok(())
    }

    /// Register as a validator by staking SOL.
    pub fn register_validator(ctx: Context<RegisterValidator>, stake_amount: u64) -> Result<()> {
        let config = &ctx.accounts.protocol_config;
        require!(
            stake_amount >= config.min_stake,
            RegistryError::InsufficientStake
        );

        // Transfer stake from validator to vault
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.validator.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            stake_amount,
        )?;

        let validator_state = &mut ctx.accounts.validator_state;
        validator_state.authority = ctx.accounts.validator.key();
        validator_state.stake = stake_amount;
        validator_state.registration_time = Clock::get()?.unix_timestamp;
        validator_state.is_active = true;
        validator_state.verifications_performed = 0;
        validator_state.bump = ctx.bumps.validator_state;

        emit!(ValidatorRegistered {
            authority: validator_state.authority,
            stake: stake_amount,
        });

        Ok(())
    }

    /// Compute trust score from verification count and account age.
    /// Returns the score via event emission.
    pub fn compute_trust_score(
        ctx: Context<ComputeTrustScore>,
        verification_count: u32,
        creation_timestamp: i64,
    ) -> Result<()> {
        let config = &ctx.accounts.protocol_config;
        let now = Clock::get()?.unix_timestamp;

        let age_seconds = now
            .checked_sub(creation_timestamp)
            .ok_or(RegistryError::ArithmeticOverflow)?;
        let age_days: u64 = (age_seconds / 86400).try_into().unwrap_or(0);

        let base_score = u64::from(verification_count)
            .checked_mul(u64::from(config.base_trust_increment))
            .ok_or(RegistryError::ArithmeticOverflow)?;

        let capped_age_days = age_days.min(365);
        let age_bonus = capped_age_days
            .checked_mul(2)
            .ok_or(RegistryError::ArithmeticOverflow)?;

        let total = base_score
            .checked_add(age_bonus)
            .ok_or(RegistryError::ArithmeticOverflow)?;

        let trust_score = total.min(u64::from(config.max_trust_score)) as u16;

        emit!(TrustScoreComputed {
            verification_count,
            creation_timestamp,
            trust_score,
        });

        Ok(())
    }
}

// --- Account Contexts ---

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = ProtocolConfig::LEN,
        seeds = [b"protocol_config"],
        bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterValidator<'info> {
    #[account(mut)]
    pub validator: Signer<'info>,

    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        init,
        payer = validator,
        space = ValidatorState::LEN,
        seeds = [b"validator", validator.key().as_ref()],
        bump,
    )]
    pub validator_state: Account<'info, ValidatorState>,

    /// CHECK: Vault PDA that holds staked SOL. No data deserialization needed.
    #[account(
        mut,
        seeds = [b"vault"],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ComputeTrustScore<'info> {
    #[account(
        seeds = [b"protocol_config"],
        bump = protocol_config.bump,
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

// --- Events ---

#[event]
pub struct ValidatorRegistered {
    pub authority: Pubkey,
    pub stake: u64,
}

#[event]
pub struct TrustScoreComputed {
    pub verification_count: u32,
    pub creation_timestamp: i64,
    pub trust_score: u16,
}
