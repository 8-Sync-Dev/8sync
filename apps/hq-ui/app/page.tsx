import { headers } from "next/headers";
import { HqApp } from "@/components/hq/hq-app";
import { isLocalHost, getToken } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * The token reaches the browser only through this same-origin render
 * (contract §2). A non-loopback Host (DNS rebinding) never gets it.
 */
export default async function Page() {
  const h = await headers();
  if (!isLocalHost(h.get("host"))) {
    return (
      <main className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
        HQ only answers on 127.0.0.1.
      </main>
    );
  }
  return <HqApp token={getToken()} />;
}
