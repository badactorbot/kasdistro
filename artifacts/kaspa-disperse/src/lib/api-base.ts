// The same Replit deployment serves both the site and /api. Standalone sites
// built from the repository need a public API origin instead.
const PUBLIC_API_ORIGIN = 'https://kasdistro.replit.app';

export function resolveApiBase(): string {
  const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (configuredApiBase) return configuredApiBase;

  const hostname = window.location.hostname;
  const usesSameOriginApi = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname.endsWith('.replit.app')
    || hostname.endsWith('.replit.dev');

  return usesSameOriginApi ? '' : PUBLIC_API_ORIGIN;
}