import { useState } from 'react';
import { useVerifyBotActivation, getGetUserBotDashboardQueryKey, FixedStrategy, UserBotDashboard } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { extractKaswareTransactionId, getKasware } from '@/lib/kasware';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2, ShieldAlert, ArrowRight, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type ActiveBot = NonNullable<UserBotDashboard['bot']>;

export function BotActivation({ strategy, bot }: { strategy: FixedStrategy, bot: ActiveBot }) {
  const pendingTransactionKey = `kron-pending-activation-txid-v${bot.configurationVersion}`;
  const [isPaying, setIsPaying] = useState(false);
  const [previousTransactionId, setPreviousTransactionId] = useState(
    () => localStorage.getItem(pendingTransactionKey) ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const verifyActivation = useVerifyBotActivation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const verifyWithRetry = async (transactionId: string) => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        return await verifyActivation.mutateAsync({ data: { transactionId } });
      } catch (err: any) {
        const message = err.data?.error || err.response?.data?.error || err.message || '';
        const confirmationPending = message.includes('activation payment was not found');
        if (!confirmationPending) throw err;
        if (attempt === 20) {
          throw new Error(
            'Payment was sent but is still awaiting chain confirmation. Your transaction ID is saved below; wait a moment, then select Verify Payment. Do not pay again.',
          );
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3_000));
      }
    }
    throw new Error('Payment confirmation retry ended unexpectedly.');
  };

  const handlePayActivation = async () => {
    try {
      setIsPaying(true);
      setError(null);
      const kasware = getKasware();
      
      if (!kasware) {
        throw new Error('Kasware wallet is not available. Please install the extension.');
      }

      // 1 KAS = 100000000 sompi
      const amountSompi = Math.floor(strategy.activationFeeKas * 100000000);
      
      const transaction = await kasware.sendKaspa(strategy.activationAddress, amountSompi);
      const txid = extractKaswareTransactionId(transaction);

      if (!txid) {
        throw new Error('Transaction failed or was rejected by wallet.');
      }

      localStorage.setItem(pendingTransactionKey, txid);
      setPreviousTransactionId(txid);
      await verifyWithRetry(txid);
      localStorage.removeItem(pendingTransactionKey);
      queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      toast({ title: 'Activation successful' });

    } catch (err: any) {
      setError(err.data?.error || err.response?.data?.error || err.message || 'Failed to pay activation fee');
      toast({ title: 'Activation failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsPaying(false);
    }
  };

  const handleVerifyPreviousPayment = async () => {
    try {
      setIsPaying(true);
      setError(null);
      const txid = extractKaswareTransactionId(previousTransactionId);
      await verifyActivation.mutateAsync({ data: { transactionId: txid } });
      localStorage.removeItem(pendingTransactionKey);
      queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      toast({ title: 'Previous activation payment verified' });
    } catch (err: any) {
      setError(err.data?.error || err.response?.data?.error || err.message || 'Could not verify the previous payment');
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto mt-8">
      <div className="flex items-center gap-2 mb-6 text-primary">
        <ShieldCheck className="w-5 h-5" />
        <h2 className="text-sm font-bold tracking-widest uppercase">Activate Bot Workspace</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="md:col-span-3 space-y-6">
          <Card className="bg-card border-card-border shadow-xl rounded-xl">
            <CardHeader className="pb-4">
              <CardTitle className="text-xs font-bold tracking-widest uppercase text-muted-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-success" />
                Isolated Bot Wallet Created
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm">
                <p className="font-mono text-xs mb-4 bg-background/80 p-3 rounded-lg border border-border/50 text-primary break-all">
                  {bot.botAddress}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  This address is completely isolated from your primary wallet. The automation server can only access funds explicitly transferred to this specific address.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-card-border shadow-xl rounded-xl">
            <CardContent className="p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold tracking-widest uppercase text-muted-foreground">Activation Fee</p>
                <p className="text-[10px] text-muted-foreground/70 mt-1 uppercase tracking-wider">Required to unlock trading</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-bold text-primary">{strategy.activationFeeKas} KAS</p>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-primary/90 leading-relaxed">
            <p className="font-bold uppercase tracking-wider mb-2">Two wallet approvals are required</p>
            <p className="opacity-80">
              First pay the 100 KAS activation fee. Next, fund your isolated bot wallet with trading capital.
              At 10 trades per hour, 1,000 KAS is estimated to support roughly 3–4 days of trading.
              A 30-day run may require about 8,500 KAS, based on recent fees and prices. Actual duration will vary.
            </p>
          </div>
        </div>

        <div className="md:col-span-2 space-y-6">
          <Card className="bg-card border-card-border shadow-xl rounded-xl">
            <CardHeader className="pb-4">
              <CardTitle className="text-xs font-bold tracking-widest uppercase text-muted-foreground">Payment Action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {error && (
                <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground rounded-lg">
                  <ShieldAlert className="h-4 w-4" />
                  <AlertTitle className="font-semibold text-[10px] uppercase tracking-wider">Payment Not Yet Verified</AlertTitle>
                  <AlertDescription className="mt-1 text-xs">{error}</AlertDescription>
                </Alert>
              )}

              <Button 
                onClick={handlePayActivation}
                disabled={isPaying || verifyActivation.isPending}
                className="w-full h-12 text-sm font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(45,212,191,0.1)] hover:shadow-[0_0_25px_rgba(45,212,191,0.3)] transition-all duration-300"
                data-testid="button-pay-activation"
              >
                {isPaying || verifyActivation.isPending ? 'Confirming Payment...' : 'Pay Activation Fee'}
                {!(isPaying || verifyActivation.isPending) && <ArrowRight className="w-4 h-4 ml-2" />}
              </Button>

              <div className="pt-6 border-t border-border/50">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Already paid?</p>
                <p className="text-[10px] text-muted-foreground/70 mb-3 leading-relaxed">
                  Enter the transaction ID to verify the existing payment. This does not send another transaction.
                </p>
                <div className="flex flex-col gap-3">
                  <Input
                    value={previousTransactionId}
                    onChange={(event) => setPreviousTransactionId(event.target.value)}
                    placeholder="64-character transaction ID"
                    className="font-mono text-xs bg-background/50 border-border/50 focus-visible:ring-primary/50"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full text-xs font-bold uppercase tracking-widest h-10"
                    disabled={isPaying || !previousTransactionId.trim()}
                    onClick={handleVerifyPreviousPayment}
                  >
                    Verify Payment
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
