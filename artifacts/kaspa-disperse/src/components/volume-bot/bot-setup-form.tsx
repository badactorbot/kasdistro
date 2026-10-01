import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useSetupUserBot, getGetUserBotDashboardQueryKey, FixedStrategy } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, Settings2 } from 'lucide-react';

const setupSchema = z.object({
  tokenId: z.string().length(64, 'Token ID must be exactly 64 characters (covenant ID)'),
});

export function BotSetupForm({ strategy }: { strategy: FixedStrategy }) {
  const [error, setError] = useState<string | null>(null);
  const setupBot = useSetupUserBot();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      tokenId: '',
    },
  });

  const onSubmit = async (values: z.infer<typeof setupSchema>) => {
    try {
      setError(null);
      await setupBot.mutateAsync({ data: { tokenId: values.tokenId } });
      queryClient.invalidateQueries({ queryKey: getGetUserBotDashboardQueryKey() });
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to setup bot');
    }
  };

  return (
    <div className="max-w-3xl mx-auto mt-8">
      <div className="flex items-center gap-2 mb-6 text-primary">
        <Settings2 className="w-5 h-5" />
        <h2 className="text-sm font-bold tracking-widest uppercase">Configure Target Token</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card border-card-border shadow-xl rounded-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-xs font-bold tracking-widest uppercase text-muted-foreground">Fixed Strategy Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-y-6 gap-x-6 text-sm">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Order Size</span>
                <span className="font-semibold text-primary">{strategy.orderSizeKas} KAS</span>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Targets</span>
                <span className="font-semibold text-foreground">{strategy.buyCount} Buys, {strategy.sellCount} Sells</span>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Pacing</span>
                <span className="font-semibold text-foreground">{strategy.tradesPerHour} trades / hr</span>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Activation Fee</span>
                <span className="font-semibold text-foreground">{strategy.activationFeeKas} KAS</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border shadow-xl rounded-xl">
          <CardHeader className="pb-4">
            <CardTitle className="text-xs font-bold tracking-widest uppercase text-muted-foreground">Enter Covenant ID</CardTitle>
            <CardDescription className="text-xs mt-1">Enter the Kaspa token covenant ID for automated trading.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="tokenId"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input 
                          placeholder="e.g. 1a2b3c... (64 chars)" 
                          className="font-mono text-xs h-12 bg-background/50 border-border/50 focus-visible:ring-primary/50 placeholder:text-muted-foreground/50" 
                          data-testid="input-token-id"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
                {error && <p className="text-xs text-destructive font-medium bg-destructive/10 p-3 rounded-md border border-destructive/20">{error}</p>}
                
                <Button 
                  type="submit" 
                  className="w-full h-12 text-sm font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(45,212,191,0.1)] hover:shadow-[0_0_25px_rgba(45,212,191,0.3)] transition-all duration-300" 
                  disabled={setupBot.isPending}
                  data-testid="button-setup-bot"
                >
                  {setupBot.isPending ? 'Validating Token...' : 'Continue to Activation'}
                  {!setupBot.isPending && <ArrowRight className="w-4 h-4 ml-2" />}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
