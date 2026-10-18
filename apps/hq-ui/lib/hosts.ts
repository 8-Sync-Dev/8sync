// Loopback Host check shared by the server auth gate and the client (SSE vs. polling).

const LOCAL_HOSTS: Record<string, true> = { "127.0.0.1": true, localhost: true, "[::1]": true };

/** Host header (or `location.host`) must be a loopback name (blocks DNS-rebinding). */
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(host.toLowerCase());
  return !!m && Object.hasOwn(LOCAL_HOSTS, m[1]);
}
