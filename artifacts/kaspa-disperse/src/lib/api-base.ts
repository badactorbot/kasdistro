export function resolveApiBase(): string {
  const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (configuredApiBase) return configuredApiBase;
  return '';
}
