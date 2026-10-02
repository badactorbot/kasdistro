export function kaspaApiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  return '';
}
