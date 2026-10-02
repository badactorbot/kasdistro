import {
  getGetUserBotDashboardQueryKey,
  useGetUserBotDashboard,
  useLogoutWallet,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, LogOut } from 'lucide-react';
import { LandingLayout } from '@/components/dispenser/landing-layout';
import { BotActivation } from '@/components/volume-bot/bot-activation';
import { BotDashboardView } from '@/components/volume-bot/bot-dashboard-view';
import { BotSetupForm } from '@/components/volume-bot/bot-setup-form';
import { WalletConnect } from '@/components/volume-bot/wallet-connect';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

export default function VolumeBot() {
  const { data: dashboard, isLoading, error } = useGetUserBotDashboard({
    query: {
      refetchInterval: 60_000,
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: true,
      queryKey: getGetUserBotDashboardQueryKey(),
    },
  });

  const logout = useLogoutWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Logout failed';
      toast({ title: 'Logout failed', description: message, variant: 'destructive' });
    }
  };

  const connected = Boolean(dashboard?.authenticated);

  return (
    <LandingLayout showGrid={false}>
      <div className="relative min-h-[min(92dvh,1100px)] overflow-hidden bg-[#030914]">
        <div className="absolute inset-0 z-0 pointer-events-none cyber-grid">
          <div className="absolute top-[20%] left-1/2 h-[600px] w-[1000px] -translate-x-1/2 rounded-[100%] bg-primary/10 blur-[120px] mix-blend-screen" />
        </div>
        <div className="relative z-10 mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">
              KasDistro Volume Bot Console
            </h1>
            <p className="mt-2 text-sm text-cyan-200">
              Connect Kasware, set a token, activate, then run cycles from this page.
            </p>
          </div>
          {connected && dashboard?.walletAddress ? (
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300/80">
                  Connected Wallet
                </p>
                <p className="mt-0.5 font-mono text-sm font-medium text-white">
                  {dashboard.walletAddress.slice(0, 8)}...{dashboard.walletAddress.slice(-6)}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                className="border-cyan-500/30 bg-cyan-500/10 text-xs font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-500/20"
              >
                <LogOut className="h-3.5 w-3.5 sm:mr-2" />
                <span className="hidden sm:inline">Disconnect</span>
              </Button>
            </div>
          ) : null}
        </div>

        {isLoading && !dashboard ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
          </div>
        ) : error || !dashboard || !dashboard.authenticated ? (
          <WalletConnect />
        ) : !dashboard.bot ? (
          <BotSetupForm strategy={dashboard.strategy} />
        ) : !dashboard.bot.activationPaid ? (
          <BotActivation strategy={dashboard.strategy} bot={dashboard.bot} />
        ) : (
          <BotDashboardView
            bot={dashboard.bot}
            strategy={dashboard.strategy}
            walletAddress={dashboard.walletAddress}
          />
        )}
        </div>
      </div>
    </LandingLayout>
  );
}
