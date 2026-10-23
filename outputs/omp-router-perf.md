# omp router: does it need Rust/Go or HTTP/3 work?

**Answer: no.** The edge already serves HTTP/3, and the router itself adds about 2 ms to a request whose model answer takes seconds. A Rust/Go proxy would shave a fraction of that 2 ms and add a component to maintain.

## Evidence

| Question | Measured / source | Result |
|---|---|---|
| HTTP/3 to clients? | `Alt-Svc: h3=":443"; ma=2592000` on every response; Chromium `performance.getEntriesByType("navigation")[0].nextHopProtocol` after one reload = `h3` | Yes. Caddy (Go, quic-go) on 443/udp, published in `/srv/apps/edge/compose.yml` |
| Router overhead | keep-alive HTTPS from the PC, 25 requests each: `/healthz` answered by Caddy p50 24.1 ms / p90 24.4 ms; `/omp-router/healthz` (Caddy → `systemd-socket-proxyd` → gateway) p50 25.9 ms / p90 26.9 ms | ≈ 1.8 ms |
| Socket hop on the box | 30 × curl on the VPS: `127.0.0.1:4000/healthz` p50 0.67 ms; via `/run/omp-gw/gw.sock` p50 0.90 ms | proxyd (C, ships with systemd) adds ≈ 0.23 ms |
| Model time | `zai/glm-4.5-air`, 16 tokens, through the router from the PC: 2.26–2.39 s | the request is >99% model time |
| Gateway runtime | `omp auth-gateway` is omp's own Bun binary; it is the only component that knows provider wire formats, OAuth refresh and client keys ([auth-broker-gateway.md][1]) | not replaceable without re-implementing omp's provider layer |

## Caveats
- IPv6 clients pass through docker-proxy (userland, Go) before Caddy; IPv4 uses kernel DNAT. Not measured separately.
- RSS: broker 111–119 MiB, gateway 217–238 MiB (Bun). That is the real cost of the Bun runtime; it is protected by `MemoryLow=400M` rather than rewritten.

## Sources
1. [omp docs: Auth Broker and Auth Gateway][1] (main branch, read 2026-10-23)
2. Measurements on vps.8syncdev.com, 2026-10-23 (commands in the table)

[1]: https://github.com/can1357/oh-my-pi/blob/main/docs/auth-broker-gateway.md

---
2026-10-23 · 1 round · 2 sources read (omp auth gateway + models docs) · measured: h3, latency at 3 points, model time, RSS · unverified: IPv6 path latency.
