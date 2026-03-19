import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  transfer,
} from "@solana/spl-token";
import { IamAnchor } from "../target/types/iam_anchor";

describe("iam-anchor", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.iamAnchor as Program<IamAnchor>;

  function deriveIdentityPda(user: anchor.web3.PublicKey) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("identity"), user.toBuffer()],
      program.programId
    );
  }

  function deriveMintPda(user: anchor.web3.PublicKey) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint"), user.toBuffer()],
      program.programId
    );
  }

  const [mintAuthorityPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority")],
    program.programId
  );

  const commitment = Buffer.alloc(32);
  commitment.write("initial_commitment_test", "utf-8");

  it("mints an identity anchor", async () => {
    const user = provider.wallet;
    const [identityPda] = deriveIdentityPda(user.publicKey);
    const [mintPda] = deriveMintPda(user.publicKey);
    const ata = getAssociatedTokenAddressSync(
      mintPda,
      user.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .mintAnchor(Array.from(commitment))
      .accounts({
        user: user.publicKey,
        identityState: identityPda,
        mint: mintPda,
        mintAuthority: mintAuthorityPda,
        tokenAccount: ata,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Verify IdentityState
    const identity = await program.account.identityState.fetch(identityPda);
    expect(identity.owner.toBase58()).to.equal(user.publicKey.toBase58());
    expect(identity.verificationCount).to.equal(0);
    expect(identity.trustScore).to.equal(0);
    expect(Buffer.from(identity.currentCommitment)).to.deep.equal(commitment);
    expect(identity.mint.toBase58()).to.equal(mintPda.toBase58());

    // Verify token balance
    const tokenAccount = await getAccount(
      provider.connection,
      ata,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    expect(Number(tokenAccount.amount)).to.equal(1);
  });

  it("fails to mint duplicate identity", async () => {
    const user = provider.wallet;
    const [identityPda] = deriveIdentityPda(user.publicKey);
    const [mintPda] = deriveMintPda(user.publicKey);
    const ata = getAssociatedTokenAddressSync(
      mintPda,
      user.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    try {
      await program.methods
        .mintAnchor(Array.from(commitment))
        .accounts({
          user: user.publicKey,
          identityState: identityPda,
          mint: mintPda,
          mintAuthority: mintAuthorityPda,
          tokenAccount: ata,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  it("allows different users to mint their own identity", async () => {
    const user2 = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      user2.publicKey,
      5_000_000_000
    );
    await provider.connection.confirmTransaction(sig);

    const [identityPda] = deriveIdentityPda(user2.publicKey);
    const [mintPda] = deriveMintPda(user2.publicKey);
    const ata = getAssociatedTokenAddressSync(
      mintPda,
      user2.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .mintAnchor(Array.from(commitment))
      .accounts({
        user: user2.publicKey,
        identityState: identityPda,
        mint: mintPda,
        mintAuthority: mintAuthorityPda,
        tokenAccount: ata,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([user2])
      .rpc();

    const identity = await program.account.identityState.fetch(identityPda);
    expect(identity.owner.toBase58()).to.equal(user2.publicKey.toBase58());
  });

  it("updates identity state", async () => {
    const user = provider.wallet;
    const [identityPda] = deriveIdentityPda(user.publicKey);

    const newCommitment = Buffer.alloc(32);
    newCommitment.write("updated_commitment_v2!", "utf-8");

    await program.methods
      .updateAnchor(Array.from(newCommitment), 150)
      .accounts({
        authority: user.publicKey,
        identityState: identityPda,
      })
      .rpc();

    const identity = await program.account.identityState.fetch(identityPda);
    expect(identity.verificationCount).to.equal(1);
    expect(identity.trustScore).to.equal(150);
    expect(Buffer.from(identity.currentCommitment)).to.deep.equal(newCommitment);
  });

  it("rejects transfer of non-transferable token", async () => {
    const user = provider.wallet;
    const [mintPda] = deriveMintPda(user.publicKey);
    const sourceAta = getAssociatedTokenAddressSync(
      mintPda,
      user.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const recipient = anchor.web3.Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      recipient.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(sig);

    const destAta = getAssociatedTokenAddressSync(
      mintPda,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    try {
      await transfer(
        provider.connection,
        (provider.wallet as any).payer,
        sourceAta,
        destAta,
        user.publicKey,
        1,
        [],
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect.fail("Transfer should have been rejected");
    } catch (err: any) {
      // Token-2022 NonTransferable extension rejects transfers
      expect(err).to.exist;
    }
  });
});
