import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import Home from '@/pages/home';
import DistroApp from '@/pages/distro-app';
import Kaspaper from '@/pages/kaspaper';
import VolumeBot from '@/pages/volume-bot';
import TestnetLab from '@/pages/testnet-lab';
import Kcc20Distributor from '@/pages/kcc20-distributor';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/dispenser" component={DistroApp} />
        <Route path="/distro" component={DistroApp} />
        <Route path="/kaspaper" component={Kaspaper} />
        <Route path="/volume-bot" component={VolumeBot} />
        <Route path="/testnet-lab" component={TestnetLab} />
        <Route path="/kcc20" component={Kcc20Distributor} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
