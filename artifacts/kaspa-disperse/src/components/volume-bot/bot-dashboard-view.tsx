import { useState } from 'react';
import { useStartUserBot, useStopUserBot, getGetUserBotDashboardQueryKey, UserBotDashboard, FixedStrategy } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getKasware } from '@/lib/kasware';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Play, Square, Wallet, Info, Copy, Check, ExternalLink, ScrollText } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CovenantChangeDialog } from '@/components/volume-bot/covenant-change-dialog';
import { KasWithdrawalControl } from '@/components/volume-bot/kas-withdrawal-control';

type ActiveBot = NonNullable<UserBotDashboard['bot']>;

export function BotDashboardView({ bot, strategy, walletAddress }: { bot: ActiveBot, strategy: FixedStrategy, walletAddress: string }) {
  const [fundingAmount, setFundingAmount] = useState('');
  const [isFunding, setIsFunding] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const startBot = useStartUserBot();
  const stopBot = useStopUserBot();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleStart = async () => {
    try {
      await startBot.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      toast({ title: 'Bot started successfully' });
    } catch (err: any) {
      toast({ title: 'Failed to start bot', description: err.response?.data?.error || err.message, variant: 'destructive' });
    }
  };

  const handleStop = async () => {
    try {
      await stopBot.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      toast({ title: 'Bot stopped' });
    } catch (err: any) {
      toast({ title: 'Failed to stop bot', description: err.response?.data?.error || err.message, variant: 'destructive' });
    }
  };

  const handleFund = async () => {
    const amount = parseFloat(fundingAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Invalid amount', description: 'Please enter a valid KAS amount', variant: 'destructive' });
      return;
    }

    try {
      setIsFunding(true);
      const kasware = getKasware();
      if (!kasware) throw new Error('Kasware wallet is not available. Please install the extension.');
      
      const sompi = Math.floor(amount * 100000000);
      const txid = await kasware.sendKaspa(bot.botAddress, sompi);
      
      if (txid) {
        toast({ title: 'Funding transaction sent', description: `Sent ${amount} KAS to bot wallet.` });
        setFundingAmount('');
        // We do a manual invalidate, though polling will also catch it eventually
        queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      }
    } catch (err: any) {
      toast({ title: 'Funding failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsFunding(false);
    }
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(bot.botAddress);
      setAddressCopied(true);
      toast({ title: 'Bot wallet address copied' });
      window.setTimeout(() => setAddressCopied(false), 2000);
    } catch {
      toast({
        title: 'Unable to copy address',
        description: 'Select the address and copy it manually.',
        variant: 'destructive'
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-success/10 text-success border-success/20';
      case 'paused': return 'bg-warning/10 text-warning border-warning/20';
      case 'stopped': return 'bg-destructive/10 text-destructive border-destructive/20';
      case 'ready': return 'bg-primary/10 text-primary border-primary/20';
      default: return 'bg-muted text-muted-foreground border-border/50';
    }
  };

  const isInsufficientFunds = bot.botKasBalance < strategy.orderSizeKas;

  return (
    <div className="space-y-6 max-w-6xl mx-auto mt-2">
      
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-xl font-bold tracking-widest uppercase text-foreground">
              {bot.tokenSymbol || 'Token'} Bot
            </h2>
            <Badge variant="outline" className={`uppercase tracking-widest text-[10px] px-2.5 py-0.5 font-bold ${getStatusColor(bot.status)}`}>
              {bot.status}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground font-mono bg-background/50 border border-border/50 inline-block px-2 py-1 rounded">
            {bot.tokenId}
          </p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <CovenantChangeDialog bot={bot} />
          {bot.status === 'running' ? (
            <Button variant="destructive" onClick={handleStop} disabled={stopBot.isPending} className="w-full sm:w-auto px-8 font-bold tracking-widest uppercase text-xs h-10">
              <Square className="w-3.5 h-3.5 mr-2" /> Stop Operations
            </Button>
          ) : (
            <Button onClick={handleStart} disabled={startBot.isPending || isInsufficientFunds} className="w-full sm:w-auto px-8 font-bold tracking-widest uppercase text-xs h-10 shadow-[0_0_15px_rgba(45,212,191,0.1)] hover:shadow-[0_0_25px_rgba(45,212,191,0.3)] transition-all duration-300">
              <Play className="w-3.5 h-3.5 mr-2" /> Start Trading
            </Button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {bot.status !== 'running' && isInsufficientFunds && (
        <Alert className="bg-warning/10 border-warning/20 text-warning rounded-lg">
          <Info className="w-4 h-4 text-warning" />
          <AlertTitle className="text-warning font-bold uppercase tracking-widest text-xs">Insufficient Bot Balance</AlertTitle>
          <AlertDescription className="text-warning/90 mt-1 text-xs">
            The isolated bot wallet balance ({bot.botKasBalance.toLocaleString()} KAS) is below the configured order size of {strategy.orderSizeKas} KAS. 
            Please fund the bot wallet below before starting operations.
          </AlertDescription>
        </Alert>
      )}

      {bot.stopReason && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive-foreground rounded-lg">
          <Info className="w-4 h-4 text-destructive" />
          <AlertTitle className="text-destructive font-bold uppercase tracking-widest text-xs">Bot Stopped Automatically</AlertTitle>
          <AlertDescription className="text-destructive/90 mt-1 text-xs">
            Reason: {bot.stopReason}
          </AlertDescription>
        </Alert>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Wallet & Funding */}
        <Card className="bg-card border-card-border shadow-xl rounded-xl flex flex-col">
          <CardContent className="p-6 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Bot Wallet (KAS)</p>
              <div className="p-2 bg-primary/10 rounded-md text-primary border border-primary/20">
                <Wallet className="w-4 h-4" />
              </div>
            </div>
            
            <div className="mb-6">
              <p className="text-3xl font-bold tracking-tight text-primary">
                {bot.botKasBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="mt-2 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70">
                Live chain balance · refreshes every minute
              </p>
              <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-3 shadow-[0_0_18px_rgba(45,212,191,0.08)]">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Complete Bot Funding Address
                </p>
                <p className="select-all break-all font-mono text-sm font-semibold leading-relaxed text-primary">
                  {bot.botAddress}
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleCopyAddress}
                  className="mt-3 h-9 w-full text-xs font-bold uppercase tracking-widest"
                  aria-label="Copy complete bot wallet address"
                >
                  {addressCopied ? (
                    <><Check className="mr-2 h-3.5 w-3.5" /> Copied</>
                  ) : (
                    <><Copy className="mr-2 h-3.5 w-3.5" /> Copy Address</>
                  )}
                </Button>
              </div>
            </div>

            <div className="mt-auto pt-6 border-t border-border/50">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Add Funds from Connected Wallet</p>
              <div className="flex gap-2">
                <Input 
                  placeholder="Rec: 1000 KAS"
                  value={fundingAmount}
                  onChange={e => setFundingAmount(e.target.value)}
                  type="number"
                  min="0"
                  step="0.1"
                  className="h-9 text-xs bg-background/50 border-border/50 focus-visible:ring-primary/50"
                />
                <Button size="sm" onClick={handleFund} disabled={isFunding || !fundingAmount} variant="secondary" className="h-9 px-4 text-xs font-bold uppercase tracking-widest">
                  {isFunding ? '...' : 'Transfer'}
                </Button>
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground/70">
                1,000 KAS is estimated to support about 3–4 days at 10 trades per hour. Estimates vary with token price.
              </p>
              <KasWithdrawalControl bot={bot} walletAddress={walletAddress} />
            </div>
          </CardContent>
        </Card>

        {/* Trade History */}
        <Card className="bg-card border-card-border shadow-xl rounded-xl flex flex-col">
          <CardContent className="p-6 flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Trade Log</p>
                <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/60">
                  {bot.totalTrades} completed trades
                </p>
              </div>
              <div className="p-2 bg-primary/10 rounded-md text-primary border border-primary/20">
                <ScrollText className="w-4 h-4" />
              </div>
            </div>

            <div className="max-h-[420px] min-h-[300px] space-y-2 overflow-y-auto pr-2">
              {bot.tradeHistory.length === 0 ? (
                <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-border/70">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    No trades recorded yet
                  </p>
                </div>
              ) : bot.tradeHistory.map((trade, index) => (
                <a
                  key={`${trade.transactionId}-${trade.action}`}
                  href={`https://explorer.kaspa.org/txs/${trade.transactionId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-3 rounded-lg border border-border/70 bg-background/30 p-3 transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-[10px] font-black uppercase ${
                    trade.action === 'buy'
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-warning/40 bg-warning/10 text-warning'
                  }`}>
                    {trade.action}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-foreground">
                        {trade.tokenAmount} {trade.tokenSymbol || bot.tokenSymbol || 'tokens'}
                      </p>
                      <span className="text-[9px] font-mono text-muted-foreground">#{bot.tradeHistory.length - index}</span>
                    </div>
                    <p className="mt-1 truncate font-mono text-[10px] text-primary" title={trade.transactionId}>
                      {trade.transactionId}
                    </p>
                    <p className="mt-1 text-[9px] font-mono text-muted-foreground">
                      {new Date(trade.executedAt).toLocaleString()}
                    </p>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
