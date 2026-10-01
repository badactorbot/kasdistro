export const KASPA_API_FALLBACK_ORIGIN = 'https://kasdistro.replit.app';

export function kaspaApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;

  const hostname = window.location.hostname;
  const usesSameOriginApi = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname.endsWith('.replit.app')
    || hostname.endsWith('.replit.dev');

  return usesSameOriginApi ? '' : KASPA_API_FALLBACK_ORIGIN;
}
