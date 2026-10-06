import { useState } from 'react';
import {
  getGetUserBotDashboardQueryKey,
  usePrepareUserBotKasWithdrawal,
  useSellAllUserBotManagedPositions,
  useSubmitUserBotKasWithdrawal,
  type UserBotDashboard,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getKasware } from '@/lib/kasware';

type ActiveBot = NonNullable<UserBotDashboard['bot']>;

export function KasWithdrawalControl({ bot, walletAddress }: { bot: ActiveBot; walletAddress: string }) {
  const [amountKas, setAmountKas] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sellAllOpen, setSellAllOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const prepareWithdrawal = usePrepareUserBotKasWithdrawal();
  const submitWithdrawal = useSubmitUserBotKasWithdrawal();
  const sellAll = useSellAllUserBotManagedPositions();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const amount = Number(amountKas);
  const openLotsFromHistory = bot.tradeHistory.filter((trade) => trade.action === 'buy').length
    - bot.tradeHistory.filter((trade) => trade.action === 'sell').length;
  const hasOpenPositions = bot.managedTokenAmount !== '0' || openLotsFromHistory > 0;
  const validAmount = Number.isFinite(amount) && amount >= 0.2 && amount <= bot.botKasBalance;
  const canWithdraw = bot.status !== 'running' && !hasOpenPositions && validAmount;
  const canSellAll = bot.status !== 'running' && hasOpenPositions;
  const busy = prepareWithdrawal.isPending || submitWithdrawal.isPending || sellAll.isPending;

  const handleWithdraw = async (mode: 'amount' | 'max' = 'amount') => {
    try {
      setError(null);
      const kasware = getKasware();
      if (!kasware || (mode === 'amount' && !kasware.signPskt) || (mode === 'max' && !kasware.signMessage)) {
        throw new Error('KasWare does not support the required wallet approval. Update KasWare and try again.');
      }
      const prepared = await prepareWithdrawal.mutateAsync({
        data: mode === 'max' ? { mode: 'max' } : { mode: 'amount', amountKas },
      });
      if (prepared.signInputs.length === 0 && !prepared.approvalMessage) {
        throw new Error('Withdrawal approval details are missing. Refresh and try again.');
      }
      const signedTransaction = prepared.signInputs.length === 0
        ? JSON.stringify({
          txJsonString: prepared.txJsonString,
          approvalSignature: await kasware.signMessage(prepared.approvalMessage!, 'schnorr'),
        })
        : await kasware.signPskt({
          txJsonString: prepared.txJsonString,
          options: { signInputs: prepared.signInputs },
        });
      const result = await submitWithdrawal.mutateAsync({ data: { signedTransaction } });
      setTransactionId(result.transactionId);
      setAmountKas('');
      setConfirmOpen(false);
      await queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      toast({
        title: 'Withdrawal submitted',
        description: `${result.amountKas} KAS sent to the connected wallet.`,
      });
    } catch (err: any) {
      setError(err.data?.error || err.response?.data?.error || err.message || 'Withdrawal failed');
      setConfirmOpen(false);
    }
  };

  const handleSellAll = async () => {
    try {
      setError(null);
      const result = await sellAll.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      setSellAllOpen(false);
      toast({
        title: result.complete ? 'Positions sold' : 'Sell all incomplete',
        description: result.message || `Sold ${result.soldCount} position(s).`,
        variant: result.complete ? 'default' : 'destructive',
      });
      if (!result.complete && result.message) {
        setError(result.message);
      }
    } catch (err: any) {
      await queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      setError(err.data?.error || err.response?.data?.error || err.message || 'Sell all failed');
      setSellAllOpen(false);
    }
  };

  return (
    <div className="mt-6 border-t border-border/50 pt-6">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Withdraw to Connected Wallet
      </p>
      <p className="mb-3 break-all font-mono text-[9px] text-muted-foreground/70">
        {walletAddress}
      </p>
      {bot.status === 'running' && (
        <p className="mb-3 text-[10px] text-warning">Stop trading before withdrawing.</p>
      )}
      {hasOpenPositions && (
        <div className="mb-3 space-y-2">
          <p className="text-[10px] text-warning">
            Sell all managed token positions before withdrawing.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="h-9 px-4 text-xs font-bold uppercase tracking-widest"
            disabled={!canSellAll || busy}
            onClick={() => {
              setError(null);
              setSellAllOpen(true);
            }}
          >
            {sellAll.isPending ? 'Selling…' : 'Sell All'}
          </Button>
          <p className="text-[9px] leading-relaxed text-muted-foreground/70">
            Sells remaining tokens from the bot wallet so you can withdraw KAS.
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={amountKas}
          onChange={(event) => setAmountKas(event.target.value)}
          placeholder="KAS amount"
          inputMode="decimal"
          className="h-9 text-xs"
        />
        <Button
          size="sm"
          variant="secondary"
          className="h-9 px-3 text-xs font-bold uppercase tracking-widest"
          disabled={bot.status === 'running' || hasOpenPositions || bot.botKasBalance <= 0 || busy}
          onClick={() => {
            setAmountKas(bot.botKasBalance.toFixed(8).replace(/0+$/, '').replace(/\.$/, ''));
            setError(null);
            setConfirmOpen(true);
          }}
        >
          Max
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 px-4 text-xs font-bold uppercase tracking-widest"
          disabled={!canWithdraw || busy}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          Withdraw
        </Button>
      </div>
      <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground/70">
        Max empties the bot wallet, requires KasWare approval, and deducts the network fee from the amount received.
        For a specific amount, the connected KasWare wallet signs and pays the fee.
      </p>
      {error && (
        <p className="mt-3 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {transactionId && (
        <a
          href={`https://explorer.kaspa.org/txs/${transactionId}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center gap-2 break-all font-mono text-[10px] text-primary hover:underline"
        >
          {transactionId}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm KAS Withdrawal</DialogTitle>
            <DialogDescription>
              {amount >= bot.botKasBalance
                ? 'Empty the bot wallet to your authenticated connected wallet? The network fee is deducted from the displayed balance.'
                : `Send ${amountKas} KAS from the isolated bot wallet to your authenticated connected wallet?`}
              {' '}This transaction cannot be reversed.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-xs break-all">
            {walletAddress}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              onClick={() => handleWithdraw(amount >= bot.botKasBalance ? 'max' : 'amount')}
              disabled={busy}
            >
              {prepareWithdrawal.isPending || submitWithdrawal.isPending ? 'Submitting...' : 'Confirm Withdrawal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sellAllOpen} onOpenChange={setSellAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sell All Managed Positions</DialogTitle>
            <DialogDescription>
              Sell every remaining managed token lot from the bot wallet
              ({bot.managedTokenAmount} {bot.tokenSymbol || 'tokens'} on-chain)?
              This sells all open lots in one run (may take several minutes while the market settles between trades).
              It uses the bot key and cannot be reversed. When finished, you can withdraw KAS.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSellAllOpen(false)} disabled={sellAll.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSellAll} disabled={sellAll.isPending}>
              {sellAll.isPending ? 'Selling…' : 'Confirm Sell All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
