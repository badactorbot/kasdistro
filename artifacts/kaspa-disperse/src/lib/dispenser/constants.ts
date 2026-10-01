export const VOLUME_BOT_URL =
  'https://kcc-20-kron-trading-bot.replit.app/volume-bot';

export const SERVICE_FEE_KAS = 100;
export const SERVICE_FEE_ADDRESS =
  'kaspa:qz6dltvkds80wf8raac504ze4nesgnk72n24jr7krum2m8dq34khvkevr88cc';

export const KRON_CHART_URL =
  'https://kron.technology/token/bed3c81787e07988c6d5792fb02324bfd11b980a123f87a28eb177eeec6084a0';
export const KRON_TOKEN_TICK = 'KDIST';
export const KRON_IDX_URL = 'https://idx.kron.technology';

export const TOKEN_DISTRIBUTION = [
  {
    label: 'Burn',
    pct: 40,
    color: '#34d399',
    description: 'Permanently removed from circulation.',
  },
  {
    label: 'Dev',
    pct: 1,
    color: '#c084fc',
    description: 'Allocated to ongoing product development.',
  },
  {
    label: 'Team',
    pct: 4,
    color: '#818cf8',
    description: 'Supports continued development and operations.',
  },
  {
    label: 'Marketing',
    pct: 5,
    color: '#fbbf24',
    description: 'Funds campaigns, outreach, and growth.',
  },
  {
    label: 'Community',
    pct: 50,
    color: '#22d3ee',
    description: 'Returned to the ecosystem for rewards and incentives.',
  },
] as const;
