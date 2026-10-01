import { useState } from 'react';
import { useCreateWalletChallenge, useVerifyWalletChallenge, getGetUserBotDashboardQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getKasware } from '@/lib/kasware';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';

export function WalletConnect() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createChallenge = useCreateWalletChallenge();
  const verifyChallenge = useVerifyWalletChallenge();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleConnect = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      const kasware = getKasware();
      
      if (!kasware) {
        throw new Error('Kasware wallet is not installed. Please install the Kasware extension.');
      }

      const accounts = await kasware.requestAccounts();
      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found. Please unlock your wallet.');
      }
      const walletAddress = accounts[0];
      const publicKey = await kasware.getPublicKey();

      // 1. Create challenge
      const challenge = await createChallenge.mutateAsync({
        data: { walletAddress, publicKey }
      });

      // 2. Sign challenge message
      const signature = await kasware.signMessage(challenge.message, 'schnorr');

      // 3. Verify challenge
      await verifyChallenge.mutateAsync({
        data: {
          walletAddress,
          publicKey,
          challengeId: challenge.challengeId,
          signature
        }
      });

      // 4. Invalidate dashboard
      queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      toast({ title: 'Wallet connected successfully' });
      
    } catch (err: any) {
      setError(err.message || 'Failed to connect wallet');
      toast({ title: 'Connection failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] w-full max-w-md mx-auto">
      <Card className="w-full bg-card border-card-border shadow-2xl p-1 rounded-xl">
        <CardContent className="flex flex-col items-center p-8 text-center">
          <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-6 border border-primary/20">
            <Wallet className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-xl font-bold tracking-widest uppercase mb-3 text-foreground">Connect to Kron</h2>
          <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
            Connect Kasware to verify ownership and open your trading console. Your primary wallet key never leaves Kasware.
          </p>

          {error && (
            <Alert variant="destructive" className="mb-8 text-left w-full bg-destructive/10 border-destructive/20 text-destructive-foreground rounded-lg">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle className="font-semibold text-xs uppercase tracking-widest">Connection Failed</AlertTitle>
              <AlertDescription className="mt-1 text-xs">{error}</AlertDescription>
            </Alert>
          )}

          <Button 
            onClick={handleConnect} 
            disabled={isConnecting}
            className="w-full h-12 text-sm font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(45,212,191,0.2)] hover:shadow-[0_0_25px_rgba(45,212,191,0.4)] transition-all duration-300"
            data-testid="button-connect-wallet"
          >
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
