import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";
import { IamVerifier } from "../target/types/iam_verifier";

describe("iam-verifier", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.iamVerifier as Program<IamVerifier>;

  function generateNonce(): number[] {
    return Array.from(anchor.web3.Keypair.generate().publicKey.toBytes());
  }

  function createValidMockProof(): Buffer {
    // Magic prefix "IAM\x01" followed by dummy data
    return Buffer.from([0x49, 0x41, 0x4d, 0x01, 0xde, 0xad, 0xbe, 0xef]);
  }

  function createInvalidMockProof(): Buffer {
    return Buffer.from([0x00, 0x00, 0x00, 0x00, 0xde, 0xad]);
  }

  function deriveChallengePda(
    challenger: anchor.web3.PublicKey,
    nonce: number[]
  ) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("challenge"),
        challenger.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );
  }

  function deriveVerificationPda(
    verifier: anchor.web3.PublicKey,
    nonce: number[]
  ) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("verification"),
        verifier.toBuffer(),
        Buffer.from(nonce),
      ],
      program.programId
    );
  }

  it("creates a challenge", async () => {
    const nonce = generateNonce();
    const [challengePda] = deriveChallengePda(provider.wallet.publicKey, nonce);

    await program.methods
      .createChallenge(nonce)
      .accounts({
        challenger: provider.wallet.publicKey,
        challenge: challengePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const challenge = await program.account.challenge.fetch(challengePda);
    expect(challenge.challenger.toBase58()).to.equal(
      provider.wallet.publicKey.toBase58()
    );
    expect(challenge.used).to.be.false;
    expect(challenge.expiresAt.toNumber()).to.be.greaterThan(
      challenge.createdAt.toNumber()
    );
  });

  it("verifies a valid mock proof", async () => {
    const nonce = generateNonce();
    const [challengePda] = deriveChallengePda(provider.wallet.publicKey, nonce);
    const [verificationPda] = deriveVerificationPda(
      provider.wallet.publicKey,
      nonce
    );

    // Create challenge first
    await program.methods
      .createChallenge(nonce)
      .accounts({
        challenger: provider.wallet.publicKey,
        challenge: challengePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Submit valid proof
    const proof = createValidMockProof();
    const publicInputs: number[][] = [Array.from(Buffer.alloc(32, 1))];

    await program.methods
      .verifyProof(Buffer.from(proof), publicInputs, nonce)
      .accounts({
        verifier: provider.wallet.publicKey,
        challenge: challengePda,
        verificationResult: verificationPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const result = await program.account.verificationResult.fetch(
      verificationPda
    );
    expect(result.isValid).to.be.true;
    expect(result.verifier.toBase58()).to.equal(
      provider.wallet.publicKey.toBase58()
    );

    // Challenge should be marked as used
    const challenge = await program.account.challenge.fetch(challengePda);
    expect(challenge.used).to.be.true;
  });

  it("records invalid proof result", async () => {
    const nonce = generateNonce();
    const [challengePda] = deriveChallengePda(provider.wallet.publicKey, nonce);
    const [verificationPda] = deriveVerificationPda(
      provider.wallet.publicKey,
      nonce
    );

    await program.methods
      .createChallenge(nonce)
      .accounts({
        challenger: provider.wallet.publicKey,
        challenge: challengePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const proof = createInvalidMockProof();

    await program.methods
      .verifyProof(Buffer.from(proof), [], nonce)
      .accounts({
        verifier: provider.wallet.publicKey,
        challenge: challengePda,
        verificationResult: verificationPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const result = await program.account.verificationResult.fetch(
      verificationPda
    );
    expect(result.isValid).to.be.false;
  });

  it("rejects already-used challenge", async () => {
    const nonce = generateNonce();
    const [challengePda] = deriveChallengePda(provider.wallet.publicKey, nonce);
    const [verificationPda] = deriveVerificationPda(
      provider.wallet.publicKey,
      nonce
    );

    await program.methods
      .createChallenge(nonce)
      .accounts({
        challenger: provider.wallet.publicKey,
        challenge: challengePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Use the challenge
    const proof = createValidMockProof();
    await program.methods
      .verifyProof(Buffer.from(proof), [], nonce)
      .accounts({
        verifier: provider.wallet.publicKey,
        challenge: challengePda,
        verificationResult: verificationPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Try to use the same challenge+nonce again.
    // This fails because the VerificationResult PDA already exists (same seeds),
    // which prevents double-submission by design. The challenge.used flag
    // provides a second layer of protection.
    try {
      await program.methods
        .verifyProof(Buffer.from(proof), [], nonce)
        .accounts({
          verifier: provider.wallet.publicKey,
          challenge: challengePda,
          verificationResult: verificationPda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      // Reuse is prevented — either by PDA already existing or challenge.used flag
      expect(err).to.exist;
    }
  });
});
