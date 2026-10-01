import { inspectTestnetToken } from './testnet-preflight.mjs';

const [address, ticker] = process.argv.slice(2);
inspectTestnetToken(address, ticker)
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error); process.exitCode = 1; });