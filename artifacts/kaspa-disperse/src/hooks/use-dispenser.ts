import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveApiBase } from '@/lib/api-base';
import { SERVICE_FEE_KAS } from '@/lib/dispenser/constants';
import { KASPA_WALLETS, type WalletAccount } from '@/lib/dispenser/wallets';

export interface Recipient {
  address: string;
  amount: number;
}

export interface TransferStatus {
  status: 'pending' | 'signing' | 'sent' | 'failed';
  txId: string;
  error?: string;
}

export interface TransactionReview {
  txJsonString: string;
  inputIndicesToSign: number[];
  recipientTotalSompi: string;
  serviceFeeSompi: string;
  networkFeeSompi: string;
  grandTotalSompi: string;
  mass: number;
  maximumMass: number;
}

function sompiToKas(sompi: string) {
  return (Number(sompi) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

async function buildDispersalReview(senderAddress: string, recipients: Recipient[]) {
  const apiBase = resolveApiBase();
  const request = () =>
    fetch(`${apiBase}/api/kaspa/build-pskt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      cache: 'no-store',
      body: JSON.stringify({ senderAddress, recipients }),
    });

  let response = await request();
  let responseText = await response.text();

  // A deployed proxy can occasionally close a successful response before its
  // body reaches the browser. Retrying is safe because this endpoint only
  // prepares an unsigned transaction and does not spend or broadcast funds.
  if (response.ok && responseText.trim() === '') {
    response = await request();
    responseText = await response.text();
  }

  if (responseText.trim() === '') {
    throw new Error(
      `Transaction service returned an empty response (HTTP ${response.status}). Check that the hosted API is reachable and try again.`,
    );
  }

  let body: { error?: string } & TransactionReview;
  try {
    body = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Transaction service returned an invalid response (HTTP ${response.status}). Please try again.`,
    );
  }

  if (!response.ok) {
    throw new Error(body?.error || `Could not prepare transaction (HTTP ${response.status}).`);
  }

  return body;
}

export function useDispenser() {
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [walletLoading, setWalletLoading] = useState<string | null>(null);
  const [walletError, setWalletError] = useState('');
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({});
  const [inputTab, setInputTab] = useState<'manual' | 'csv'>('manual');

  const [rawInput, setRawInput] = useState('');
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<TransferStatus[]>([]);
  const [serviceFeeStatus, setServiceFeeStatus] = useState<TransferStatus>({
    status: 'pending',
    txId: '',
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [review, setReview] = useState<TransactionReview | null>(null);
  const [transactionError, setTransactionError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const check = () => {
      const map: Record<string, boolean> = {};
      KASPA_WALLETS.forEach((w) => {
        if (w.type === 'extension' && w.getProvider) map[w.id] = !!w.getProvider();
      });
      setInstalledMap(map);
    };
    check();
    const t = setTimeout(check, 600);
    return () => clearTimeout(t);
  }, [isWalletModalOpen]);

  const handleParseInput = useCallback((text: string) => {
    setRawInput(text);
    const parsed: Recipient[] = [];
    const errors: string[] = [];

    text.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const parts = trimmed.split(/[\s,=]+/);
      if (parts.length >= 2) {
        const address = parts[0].trim();
        const amount = parseFloat(parts[1].trim());
        const validAddr = address.startsWith('kaspa:') || address.startsWith('kaspatest:');
        if (!validAddr) errors.push(`Line ${i + 1}: Invalid address`);
        else if (isNaN(amount) || amount <= 0) errors.push(`Line ${i + 1}: Invalid amount`);
        else parsed.push({ address, amount });
      } else if (trimmed.length > 0) {
        errors.push(`Line ${i + 1}: Could not parse`);
      }
    });

    setRecipients(parsed);
    setParseErrors(errors);
    setStatuses(parsed.map(() => ({ status: 'pending', txId: '' })));
    setServiceFeeStatus({ status: 'pending', txId: '' });
    setReview(null);
    setTransactionError('');
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (ev) => handleParseInput(ev.target?.result as string);
      reader.readAsText(file);
    },
    [handleParseInput],
  );

  const handleConnectWallet = async (wallet: (typeof KASPA_WALLETS)[number]) => {
    setWalletError('');
    setWalletLoading(wallet.id);
    try {
      if (wallet.type === 'extension') {
        const provider = wallet.getProvider ? wallet.getProvider() : null;
        if (!provider) throw new Error(`${wallet.name} is not installed.`);
        let accounts: unknown[] = [];
        if (typeof provider.requestAccounts === 'function') accounts = await provider.requestAccounts();
        else if (typeof provider.connect === 'function') accounts = await provider.connect();
        else if (typeof provider.getAccounts === 'function') accounts = await provider.getAccounts();
        if (!accounts?.length) throw new Error('No account returned from wallet.');
        const first = accounts[0] as string | { address: string };
        const addr = typeof first === 'string' ? first : first.address;
        setAccount({ address: addr, walletId: wallet.id, walletName: wallet.name, provider });
        setIsWalletModalOpen(false);
      } else {
        window.open(wallet.downloadUrl, '_blank');
      }
    } catch (err: unknown) {
      setWalletError(err instanceof Error ? err.message : 'Failed to connect.');
    } finally {
      setWalletLoading(null);
    }
  };

  const handlePrepareReview = async () => {
    if (!account) {
      setIsWalletModalOpen(true);
      return;
    }
    if (recipients.length === 0) return;

    const provider = account.provider;
    if (
      account.walletId !== 'kasware' ||
      typeof provider?.signPskt !== 'function' ||
      typeof provider?.pushTx !== 'function'
    ) {
      setTransactionError('Single-approval dispersals currently require KasWare Wallet.');
      return;
    }

    setIsProcessing(true);
    setTransactionError('');
    try {
      setReview(await buildDispersalReview(account.address, recipients));
    } catch (err: unknown) {
      setTransactionError(err instanceof Error ? err.message : 'Could not prepare transaction.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSignAndBroadcast = async () => {
    if (!account || !review) return;
    setIsProcessing(true);
    setTransactionError('');
    setStatuses(recipients.map(() => ({ status: 'signing', txId: '' })));
    setServiceFeeStatus({ status: 'signing', txId: '' });
    try {
      const signed = await account.provider.signPskt({
        txJsonString: review.txJsonString,
        options: {
          signInputs: review.inputIndicesToSign.map((index) => ({ index, sighashType: 1 })),
        },
      });
      const signedJson = typeof signed === 'string' ? signed : signed?.txJsonString;
      if (!signedJson) throw new Error('KasWare did not return a signed transaction.');
      const pushed = await account.provider.pushTx(signedJson);
      const txId =
        typeof pushed === 'string'
          ? (() => {
              try {
                return JSON.parse(pushed)?.id ?? pushed;
              } catch {
                return pushed;
              }
            })()
          : (pushed?.id ?? pushed?.txId ?? '');
      setStatuses(recipients.map(() => ({ status: 'sent', txId })));
      setServiceFeeStatus({ status: 'sent', txId });
      setReview(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Transaction was rejected.';
      setStatuses(recipients.map(() => ({ status: 'failed', txId: '', error: message })));
      setServiceFeeStatus({ status: 'failed', txId: '', error: message });
      setTransactionError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecute = () => {
    if (review) return handleSignAndBroadcast();
    return handlePrepareReview();
  };

  const removeRecipient = (idx: number) => {
    const next = recipients.filter((_, i) => i !== idx);
    handleParseInput(next.map((r) => `${r.address} ${r.amount}`).join('\n'));
  };

  const totalKas = recipients.reduce((s, r) => s + r.amount, 0);
  const grandTotal = totalKas + (recipients.length > 0 ? SERVICE_FEE_KAS : 0);
  const signingIdx = statuses.findIndex((s) => s.status === 'signing');
  const isFeeSigning = serviceFeeStatus.status === 'signing';
  const pendingCount = statuses.filter((s) => s.status === 'pending').length;
  const sentCount = statuses.filter((s) => s.status === 'sent').length;

  return {
    account,
    setAccount,
    isWalletModalOpen,
    setIsWalletModalOpen,
    walletLoading,
    walletError,
    installedMap,
    inputTab,
    setInputTab,
    rawInput,
    handleParseInput,
    recipients,
    parseErrors,
    statuses,
    serviceFeeStatus,
    isProcessing,
    dragOver,
    setDragOver,
    fileInputRef,
    handleFile,
    handleConnectWallet,
    handleExecute,
    removeRecipient,
    totalKas,
    grandTotal,
    signingIdx,
    isFeeSigning,
    pendingCount,
    sentCount,
    review,
    transactionError,
    sompiToKas,
  };
}
