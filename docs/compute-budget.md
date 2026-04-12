# Compute Budget

Measured via `sol_log_compute_units()` on localnet with `anchor test`. Default limit is 200,000 CU per instruction.

## iam-anchor

| Instruction | CU Consumed | Headroom | Notes |
|-------------|-------------|----------|-------|
| mint_anchor | 46,539 - 58,539 | ~142K - 154K | Variance from Token-2022 extension initialization |
| update_anchor | 6,778 | ~193K | Trust score computation is lightweight |

## iam-registry

| Instruction | CU Consumed | Headroom | Notes |
|-------------|-------------|----------|-------|
| initialize_protocol | 6,796 | ~193K | One-time admin instruction |
| register_validator | 14,466 - 18,966 | ~181K - 186K | Variance from stake transfer amount |
| compute_trust_score | 3,449 - 5,928 | ~194K - 197K | Varies with verification history length |
| unstake_validator | 8,873 | ~191K | |

## iam-verifier

| Instruction | CU Consumed | Headroom | Notes |
|-------------|-------------|----------|-------|
| create_challenge | 7,523 - 13,523 | ~187K - 193K | Variance from PDA creation |
| verify_proof | 109,097 - 113,603 | ~87K - 91K | Groth16 on-chain verification — most compute-intensive instruction |
| close_challenge | ~500 (est.) | ~199K | Anchor close constraint, trivial |
| close_verification_result | ~500 (est.) | ~199K | Anchor close constraint, trivial |

## Key Takeaway

`verify_proof` is the compute-critical instruction at ~110K CU. In the batched verification transaction (create_challenge + verify_proof + update_anchor = ~130K CU combined), the 250K compute budget request provides ~120K CU headroom. Comfortable for devnet and mainnet.
