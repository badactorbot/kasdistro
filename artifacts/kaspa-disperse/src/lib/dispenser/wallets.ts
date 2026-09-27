export interface WalletAccount {
  address: string;
  walletId: string;
  walletName: string;
  provider: any;
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
