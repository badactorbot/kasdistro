export const SERVICE_FEE_KAS = 100;
export const SERVICE_FEE_ADDRESS =
  'kaspa:qz6dltvkds80wf8raac504ze4nesgnk72n24jr7krum2m8dq34khvkevr88cc';

export const TOKEN_DISTRIBUTION = [
  {
    label: 'Burn',
    pct: 40,
    color: '#34d399',
    description: 'Permanently removed from circulation.',
  },
  {
    label: 'Team',
    pct: 5,
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
