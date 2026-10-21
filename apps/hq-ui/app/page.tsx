import { headers } from "next/headers";
import { HqApp } from "@/components/hq/hq-app";
import { cookieValue, getToken, PUB_COOKIE, readPublic, sideOf, viaTunnel } from "@/lib/server/auth";
import { uiVersion } from "@/lib/server/version";

export const runtime = "nodejs";

/**
 * The token reaches the browser only through this same-origin render
 * (contract §2): on loopback, or on the public tunnel host with the login
 * cookie (contract C6). Any other Host (DNS rebinding, lookalike) never gets it.
 */
export default async function Page() {
  const h = await headers();
  const pub = readPublic();
  const host = h.get("host");
  const side = sideOf({ host, cookie: cookieValue(h.get("cookie"), PUB_COOKIE), tunnel: viaTunnel(h) }, pub);
  if (!side) {
    const onPublic = !!pub && host?.toLowerCase() === pub.host;
    return (
      <main className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        {onPublic ? (
          <p>
            Chưa đăng nhập hoặc link đã hết hạn. Mở lại link <code className="font-mono">/api/login?k=…</code> mà{" "}
            <code className="font-mono">8sync hq ui --public</code> in ra, rồi{" "}
            {/* A same-site full reload (not a client <Link>): the SameSite=Strict cookie is sent even when the login link was opened from another app. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="underline underline-offset-2">
              tải lại HQ
            </a>
            .
          </p>
        ) : (
          <p>HQ only answers on 127.0.0.1.</p>
        )}
      </main>
    );
  }
  return <HqApp token={getToken()} ui={uiVersion()} />;
}
