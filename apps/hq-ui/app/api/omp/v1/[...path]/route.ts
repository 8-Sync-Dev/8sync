import { proxyOmp } from "@/lib/server/omp-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The OpenAI-compatible door for members (lib/server/omp-proxy.ts): `Authorization: Bearer 8sk_…` and
 * `X-8sync-Root: <project root>`, no HQ token or login cookie. Base URL `<HQ>/api/omp/v1`.
 */
async function handle(req: Request, ctx: RouteContext<"/api/omp/v1/[...path]">) {
  const { path } = await ctx.params;
  return proxyOmp(req, path.join("/"));
}

export const GET = handle;
export const POST = handle;
