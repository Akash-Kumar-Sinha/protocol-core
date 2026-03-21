#![deny(clippy::all)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_2022;
use anchor_spl::token_interface::TokenInterface;

mod errors;
mod state;

use errors::IamAnchorError;
use state::IdentityState;

declare_id!("GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2");

/// Mint account space for Token-2022 with NonTransferable extension.
/// Base mint = 82 bytes, account type = 1 byte, extension type (2) + length (2) = 4 bytes,
/// NonTransferable data = 0 bytes. Plus multisig padding from Token-2022.
/// We use a constant derived from the Token-2022 spec.
const MINT_SIZE_WITH_NON_TRANSFERABLE: usize = 170;

#[program]
pub mod iam_anchor {
    use super::*;

    /// Mint a new IAM Anchor identity for the caller.
    /// Creates a NonTransferable Token-2022 mint, mints 1 token to the user's ATA,
    /// and initializes the IdentityState PDA.
    pub fn mint_anchor(ctx: Context<MintAnchor>, initial_commitment: [u8; 32]) -> Result<()> {
        require!(
            initial_commitment != [0u8; 32],
            IamAnchorError::InvalidCommitment
        );

        let user_key = ctx.accounts.user.key();
        let mint_seeds: &[&[u8]] = &[b"mint", user_key.as_ref(), &[ctx.bumps.mint]];
        let mint_authority_seeds: &[&[u8]] = &[b"mint_authority", &[ctx.bumps.mint_authority]];

        // 1. Allocate mint account with space for NonTransferable extension
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(MINT_SIZE_WITH_NON_TRANSFERABLE);

        system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::CreateAccount {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.mint.to_account_info(),
                },
                &[mint_seeds],
            ),
            lamports,
            MINT_SIZE_WITH_NON_TRANSFERABLE as u64,
            ctx.accounts.token_program.key,
        )?;

        // 2. Initialize NonTransferable extension (MUST be before InitializeMint2)
        let ix = spl_token_2022::instruction::initialize_non_transferable_mint(
            ctx.accounts.token_program.key,
            &ctx.accounts.mint.key(),
        )?;
        anchor_lang::solana_program::program::invoke(&ix, &[ctx.accounts.mint.to_account_info()])?;

        // 3. Initialize the mint (decimals=0, authority=mint_authority PDA)
        let ix = spl_token_2022::instruction::initialize_mint2(
            ctx.accounts.token_program.key,
            &ctx.accounts.mint.key(),
            &ctx.accounts.mint_authority.key(),
            None, // no freeze authority
            0,    // decimals
        )?;
        anchor_lang::solana_program::program::invoke(&ix, &[ctx.accounts.mint.to_account_info()])?;

        // 4. Create the user's Associated Token Account
        anchor_spl::associated_token::create(CpiContext::new(
            ctx.accounts.associated_token_program.to_account_info(),
            anchor_spl::associated_token::Create {
                payer: ctx.accounts.user.to_account_info(),
                associated_token: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
        ))?;

        // 5. Mint exactly 1 token to the user's ATA
        token_2022::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token_2022::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[mint_authority_seeds],
            ),
            1,
        )?;

        // 6. Initialize IdentityState PDA
        let identity = &mut ctx.accounts.identity_state;
        let now = Clock::get()?.unix_timestamp;
        identity.owner = ctx.accounts.user.key();
        identity.creation_timestamp = now;
        identity.last_verification_timestamp = now;
        identity.verification_count = 0;
        identity.trust_score = 0;
        identity.current_commitment = initial_commitment;
        identity.mint = ctx.accounts.mint.key();
        identity.bump = ctx.bumps.identity_state;
        identity.recent_timestamps = [0i64; 10];

        emit!(AnchorMinted {
            owner: identity.owner,
            mint: identity.mint,
            commitment: initial_commitment,
        });

        Ok(())
    }

    /// Update the identity state after a successful proof verification.
    pub fn update_anchor(
        ctx: Context<UpdateAnchor>,
        new_commitment: [u8; 32],
        new_trust_score: u16,
    ) -> Result<()> {
        require!(
            new_commitment != [0u8; 32],
            IamAnchorError::InvalidCommitment
        );

        let identity = &mut ctx.accounts.identity_state;
        identity.current_commitment = new_commitment;
        identity.verification_count = identity
            .verification_count
            .checked_add(1)
            .ok_or(IamAnchorError::ArithmeticOverflow)?;
        let now = Clock::get()?.unix_timestamp;
        identity.last_verification_timestamp = now;
        identity.trust_score = new_trust_score;

        // Shift recent_timestamps array: drop oldest, prepend newest
        for i in (1..10).rev() {
            identity.recent_timestamps[i] = identity.recent_timestamps[i - 1];
        }
        identity.recent_timestamps[0] = now;

        emit!(AnchorUpdated {
            owner: identity.owner,
            verification_count: identity.verification_count,
            trust_score: new_trust_score,
            commitment: new_commitment,
        });

        Ok(())
    }
}

// --- Account Contexts ---

#[derive(Accounts)]
pub struct MintAnchor<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = IdentityState::LEN,
        seeds = [b"identity", user.key().as_ref()],
        bump,
    )]
    pub identity_state: Account<'info, IdentityState>,

    /// CHECK: Created manually via CPI to support Token-2022 NonTransferable extension
    /// initialization ordering. PDA seeds ensure uniqueness per user.
    #[account(
        mut,
        seeds = [b"mint", user.key().as_ref()],
        bump,
    )]
    pub mint: UncheckedAccount<'info>,

    /// CHECK: PDA used as mint authority. No data stored.
    #[account(
        seeds = [b"mint_authority"],
        bump,
    )]
    pub mint_authority: UncheckedAccount<'info>,

    /// CHECK: Created via associated_token CPI. Validated by the ATA program.
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAnchor<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"identity", identity_state.owner.as_ref()],
        bump = identity_state.bump,
    )]
    pub identity_state: Account<'info, IdentityState>,
}

// --- Events ---

#[event]
pub struct AnchorMinted {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub commitment: [u8; 32],
}

#[event]
pub struct AnchorUpdated {
    pub owner: Pubkey,
    pub verification_count: u32,
    pub trust_score: u16,
    pub commitment: [u8; 32],
}
