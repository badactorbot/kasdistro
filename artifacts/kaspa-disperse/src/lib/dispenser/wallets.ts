export interface WalletAccount {
  address: string;
  walletId: string;
  walletName: string;
  provider: any;
}

const PROVIDER_INIT_EVENTS = [
  'kasware#initialized',
  'kastle#initialized',
  'nightly#initialized',
];

export async function waitForWalletProvider(
  getProvider: () => unknown,
  timeoutMs = 2500,
): Promise<any> {
  const existing = getProvider();
  if (existing) return existing;
  if (typeof window === 'undefined') return null;

  return new Promise((resolve) => {
    const started = Date.now();
    let finished = false;

    const finish = (value: unknown) => {
      if (finished) return;
      finished = true;
      window.clearInterval(poll);
      PROVIDER_INIT_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, onReady);
      });
      resolve(value);
    };

    const onReady = () => {
      const provider = getProvider();
      if (provider) finish(provider);
      else if (Date.now() - started >= timeoutMs) finish(null);
    };

    const poll = window.setInterval(onReady, 100);
    PROVIDER_INIT_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, onReady);
    });
    window.setTimeout(onReady, timeoutMs);
    onReady();
  });
}

export function extractWalletAddresses(result: unknown): string[] {
  if (!result) return [];
  if (typeof result === 'string') return result ? [result] : [];
  if (Array.isArray(result)) {
    return result.flatMap((item) => extractWalletAddresses(item));
  }
  if (typeof result === 'object') {
    const value = result as { address?: unknown; accounts?: unknown };
    if (typeof value.address === 'string') return [value.address];
    if (value.accounts) return extractWalletAddresses(value.accounts);
  }
  return [];
}

export const KASPA_WALLETS = [
  {
    id: 'kasware',
    name: 'KasWare Wallet',
    icon: '/kaspa-mark.svg',
    type: 'extension' as const,
    getProvider: () => (typeof window !== 'undefined' ? (window as any).kasware : null),
    downloadUrl:
      'https://chromewebstore.google.com/detail/kasware-wallet/hklhheigdmpoolooomdihmhlpjjdbklf',
  },
  {
    id: 'kastle',
    name: 'Kastle Wallet',
    icon: '/kaspa-mark.svg',
    type: 'extension' as const,
    getProvider: () => (typeof window !== 'undefined' ? (window as any).kastle : null),
    downloadUrl:
      'https://chromewebstore.google.com/detail/kastle/oambclflhjfppdmkghokjmpppmaebego',
  },
  {
    id: 'nightly',
    name: 'Nightly Wallet',
    icon: '/kaspa-mark.svg',
    type: 'extension' as const,
    getProvider: () =>
      typeof window !== 'undefined' ? (window as any).nightly?.kaspa : null,
    downloadUrl: 'https://nightly.app/',
  },
  {
    id: 'bitget',
    name: 'Bitget Wallet',
    icon: '/kaspa-mark.svg',
    type: 'extension' as const,
    getProvider: () =>
      typeof window !== 'undefined'
        ? (window as any).bitgetWallet?.kaspa || (window as any).bitget?.kaspa
        : null,
    downloadUrl: 'https://web3.bitget.com/',
  },
  {
    id: 'kaspium',
    name: 'Kaspium Mobile',
    icon: '/kaspa-mark.svg',
    type: 'mobile' as const,
    getProvider: null,
    downloadUrl: 'https://kaspium.io/',
  },
];
