// Deterministic throwaway constructor args for checking SilverScript syntax.
// These identifiers are fabricated and MUST NOT be used to fund a covenant.
import { writeFileSync } from 'node:fs';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: node compile-fixture.mjs <output.json>');
const bytes = value => ({ kind: 'bytes', value: Array(32).fill(value) });
const int = value => ({ kind: 'int', value });

const args = [
  bytes(9), bytes(8),
  ...[1, 2, 3, 4, 5].map(bytes),
  ...[100, 101, 102, 103, 104].map(int),
  int(5_000_000), int(46), int(0), bytes(7),
  int(510), int(300_000_000),
];
writeFileSync(destination, JSON.stringify(args, null, 2));