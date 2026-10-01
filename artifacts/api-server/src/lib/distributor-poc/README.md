# KCC-20 unsigned-distribution experiment

**Not safe for deposits.** `plan.ts` is an executable off-chain specification;
`fixed-five.sil` is an unaudited, compile-only SilverScript prototype for
exactly five recipients (three in the first payout, two in the second). Neither
generates PSKTs, uses wallet credentials, or modifies the existing Distro send
flow. A compiler success is **not** a consensus execution test.

Run the local threat-case tests:

```sh
pnpm --filter @workspace/api-server exec node --import tsx/esm --test src/lib/distributor-poc/plan.test.mts
```

Read-only preflight for a public testnet wallet and token:

```sh
pnpm --filter @workspace/api-server exec node --import tsx/esm \
  src/lib/distributor-poc/testnet-preflight-cli.mts 'kaspatest:<public-address>' <ticker>
```

It compares the KRON testnet registry and indexer to Kaspa testnet-10
transactions and the live UTXO set. It checks the token covenant ID,
ownership mode, amount, script hash, 0.5-KAS carrier, and a consistent
SilverScript template hash. It cannot prove a wallet can sign a v1 deposit.

The model fixes a recipient order, token covenant ID, token quantities,
maximum fee per batch, and KAS deposit in a plan commitment. A batch pays up
to three recipients; every token output is checked, and the token remainder
must stay owned by the distributor covenant ID. The KAS pool funds the extra
0.5-KAS token carriers plus the bounded fee; the final step refunds the
unused KAS. Tests try to alter recipients, amounts, order, remainder owner,
cursor, fee, carrier amounts, and refund. The 0.5-KAS carrier convention
must be verified for the exact deployed token.

Compile the example using the official [SilverScript v1.0.0 Linux release
binary](https://github.com/kaspanet/silverscript/releases/tag/v1.0.0)
(`silverc`) and disposable constructor arguments:

```sh
node artifacts/api-server/src/lib/distributor-poc/compile-fixture.mjs /tmp/fixed-five-args.json
silverc artifacts/api-server/src/lib/distributor-poc/fixed-five.sil \
  --constructor-args /tmp/fixed-five-args.json -o /tmp/fixed-five-compiled.json
```

The fixture contains **invented** identifiers and recipient pubkeys. The
compiled artifact must not be funded. The source currently relies on KRON's
address-presence owner mode (`0x03`), whereas the upstream KCC-20 example
only specifies modes 0, 1 and 2. Before testnet use, compare it to the
**actual deployed** token template and verify mode 3 is accepted there.

## What has to happen before an on-chain experiment

1. Pin the **deployed token's** covenant template and compiled max input/output
   bounds. Confirm that its covenant-ID ownership is implemented on testnet
   and that recipient pubkeys are interpreted as expected.
2. Review and improve the fixed-list contract before extending it to a
   user-sized list or Merkle commitments. In particular: validate the
   compiled template against live KRON test tokens, add a safe recovery
   mechanism for stalled distributions, and verify that its v1 covenant
   bindings cannot be forged or omitted. A commitment hash alone proves
   nothing unless the *script* checks each recipient and amount.
3. Compile with a compiler compatible with the deployed token and verify
   against current Kaspa consensus. The official v1.0.0 prebuilt `silverc`
   compiled the example both with fabricated fixture parameters and with a
   real testnet token's public template parameters. This Replit's Rust 1.88
   module cannot build the upstream source, which currently requires
   Rust 1.94. Compilation is not a VM test.
4. Simulate both accepted and rejected spends against a covenant VM. Model
   tests here are **not** consensus tests; they cannot prove the covenant
   enforces any rule.
5. On testnet-10, create a tiny test-token distribution, obtain a testnet
   wallet signature for the deposit, and broadcast at least two payout
   transactions without wallet signatures. Verify actual token/KAS outputs
   from the chain and test bot restart, contention, and recovery.
6. Require an independent contract security review before allowing live
   token deposits or adding the deposit control to the public app.

The KRON SDK's `covenantIdOwned()` and v1 transaction assembly are useful
references but it does not provide a distributor covenant or compiler.