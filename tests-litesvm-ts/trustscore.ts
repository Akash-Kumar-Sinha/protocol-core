import { test } from "node:test";
import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { expect } from "chai";
import type { IamAnchor } from "../target/types/iam_anchor";
import type { IamRegistry } from "../target/types/iam_registry";
import { decodeProtocolConfigWeb3js } from "./encodeDecode";
import {
  acctEqual,
  acctIsNull,
  adminKp,
  initializeProtocol,
  readAcct,
  registryAddr,
  svm,
} from "./litesvm-utils";

/*
Build the Solana programs first:
$ anchor build
Then Install NodeJs v25.9.0(or above v22.18.0) to run this TypeScript Natively: node ./file_path/this_file.ts
Or use Bun: bun test ./file_path/this_file.ts
*/
const iamAnchor = anchor.workspace.iamAnchor as anchor.Program<IamAnchor>;
const iamAnchorProgId = iamAnchor.programId;

const registry = anchor.workspace.iamRegistry as anchor.Program<IamRegistry>;

const [mintAuthorityPda] = anchor.web3.PublicKey.findProgramAddressSync(
  [Buffer.from("mint_authority")],
  iamAnchorProgId,
);
console.log("mintAuthorityPda:", mintAuthorityPda.toBase58());

const [protocolConfigPda, protocolConfigBump] =
  anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("protocol_config")],
    registry.programId,
  );

const commitment = Buffer.alloc(32);
commitment.write("initial_commitment_test", "utf-8");

let signerKp: Keypair;
let signer: PublicKey;

test("one transfer", () => {
  const payer = new Keypair();
  svm.airdrop(payer.publicKey, BigInt(LAMPORTS_PER_SOL));
  const receiver = PublicKey.unique();
  const blockhash = svm.latestBlockhash();
  const transferLamports = 1_000_000n;
  const ixs = [
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: receiver,
      lamports: transferLamports,
    }),
  ];
  const tx = new Transaction();
  tx.recentBlockhash = blockhash;
  tx.add(...ixs);
  tx.sign(payer);
  svm.sendTransaction(tx);
  const balanceAfter = svm.getBalance(receiver);
  expect(balanceAfter).eq(transferLamports);
});

test("registry.initializeProtocol()", async () => {
  signerKp = adminKp;
  signer = signerKp.publicKey;
  const min_stake = 1_000_000_000n;
  const challenge_expiry = 300n; //i64,
  const max_trust_score = 10000; //u16,
  const base_trust_increment = 100; //u16,
  const verification_fee = 0n;
  acctIsNull(protocolConfigPda);
  initializeProtocol(
    signerKp,
    protocolConfigPda,
    min_stake,
    challenge_expiry,
    max_trust_score,
    base_trust_increment,
    verification_fee,
  );

  const rawAccountData = readAcct(protocolConfigPda, registryAddr);
  const decoded = decodeProtocolConfigWeb3js(rawAccountData);
  acctEqual(decoded.admin, signer);
  expect(decoded.min_stake).eq(min_stake);
  expect(decoded.challenge_expiry).eq(challenge_expiry);
  expect(decoded.max_trust_score).eq(max_trust_score);
  expect(decoded.base_trust_increment).eq(base_trust_increment);
  expect(decoded.bump).eq(protocolConfigBump);
  expect(decoded.verification_fee).eq(verification_fee);
});
