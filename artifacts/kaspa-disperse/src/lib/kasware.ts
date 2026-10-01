export interface KaswareProvider {
  requestAccounts: () => Promise<string[]>;
  getAccounts: () => Promise<string[]>;
  getPublicKey: () => Promise<string>;
  getBalance: () => Promise<{ confirmed: string; unconfirmed: string; total: string } | null>;
  signMessage: (message: string, type?: 'auto' | 'schnorr' | 'ecdsa') => Promise<string>;
  signPskt: (input: {
    txJsonString: string;
    options: { signInputs: Array<{ index: number; sighashType: number }> };
  }) => Promise<string>;
  sendKaspa: (address: string, amountSompi: number) => Promise<string>;
}

declare global {
  interface Window {
    kasware?: KaswareProvider;
  }
}

export const getKasware = (): KaswareProvider | undefined => {
  if (typeof window !== 'undefined' && window.kasware) {
    return window.kasware;
  }
  return undefined;
};

export function extractKaswareTransactionId(value: string) {
  const trimmed = value.trim();
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed.toLowerCase();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Kasware returned an unreadable transaction response.');
  }

  const transactionId =
    typeof parsed === 'object' && parsed !== null
      ? ('id' in parsed ? parsed.id : 'transactionId' in parsed ? parsed.transactionId : undefined)
      : undefined;
  if (typeof transactionId !== 'string' || !/^[a-fA-F0-9]{64}$/.test(transactionId)) {
    throw new Error('Kasware broadcast the payment but returned no valid transaction ID.');
  }
  return transactionId.toLowerCase();
}
