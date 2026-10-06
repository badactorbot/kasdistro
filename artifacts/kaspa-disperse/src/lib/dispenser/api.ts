export function kaspaApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  // Same-origin `/api` is public on Vercel via a rewrite to the api-server service.
  // Browser code cannot use service bindings (those are server-only).
  return '';
}
