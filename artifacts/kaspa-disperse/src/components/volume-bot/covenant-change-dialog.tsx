import { useState } from 'react';
import {
  getGetUserBotDashboardQueryKey,
  useChangeUserBotCovenant,
  type UserBotDashboard,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type ActiveBot = NonNullable<UserBotDashboard['bot']>;

export function CovenantChangeDialog({ bot }: { bot: ActiveBot }) {
  const [open, setOpen] = useState(false);
  const [tokenId, setTokenId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const changeCovenant = useChangeUserBotCovenant();
  const queryClient = useQueryClient();
  const hasOpenPositions = bot.managedTokenAmount !== '0';
  const canChange = bot.status !== 'running' && !hasOpenPositions;

  const handleChange = async () => {
    try {
      setError(null);
      await changeCovenant.mutateAsync({ data: { tokenId: tokenId.trim() } });
      await queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
      setOpen(false);
      setTokenId('');
    } catch (err: any) {
      setError(err.data?.error || err.response?.data?.error || err.message || 'Failed to change covenant');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto px-5 font-bold tracking-widest uppercase text-xs h-10">
          <Settings2 className="w-3.5 h-3.5 mr-2" />
          Change Covenant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change Covenant</DialogTitle>
          <DialogDescription>
            This keeps the connected and isolated bot wallets, but creates a new bot configuration.
            All managed positions must be sold first. A new 100 KAS activation payment is required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {bot.status === 'running' && (
            <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              Stop trading before changing the covenant.
            </p>
          )}
          {hasOpenPositions && (
            <p className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              The bot still holds {bot.managedTokenAmount} managed tokens. Complete the sell cycle first.
            </p>
          )}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              New Covenant ID
            </p>
            <Input
              value={tokenId}
              onChange={(event) => setTokenId(event.target.value)}
              placeholder="64-character covenant ID"
              maxLength={64}
              className="font-mono text-xs"
            />
          </div>
          {error && (
            <p className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={handleChange}
            disabled={!canChange || tokenId.trim().length !== 64 || changeCovenant.isPending}
          >
            {changeCovenant.isPending ? 'Validating...' : 'Change & Require Activation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}