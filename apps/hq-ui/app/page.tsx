import { headers } from "next/headers";
import { GithubLogin } from "@/components/hq/github-login";
import { GuestApp } from "@/components/hq/guest-app";
import { HqApp } from "@/components/hq/hq-app";
import { getToken, readPublic } from "@/lib/server/auth";
import { readGithubConfig } from "@/lib/server/github-login";
import { cookieAccess } from "@/lib/server/http";
import { uiVersion } from "@/lib/server/version";

export const runtime = "nodejs";

/** The guest's way out of a shared view on this browser (drops `hq_guest`). */
function Leave() {
  return (
    // A full navigation: the route answers with a redirect and a cleared cookie.
    <a href="/api/login?out=1" className="underline underline-offset-2">
      thoát chế độ chia sẻ
    </a>
  );
}

/**
 * The token reaches the browser only through this same-origin render (contract §2): on loopback, or
 * on the public tunnel host with the login cookie (contract C6), and never to a guest ("Chia sẻ"
 * link): a guest page carries its role and label only, its API calls ride the `hq_guest` cookie. Any
 * other Host (DNS rebinding, lookalike) never gets it.
 */
export default async function Page() {
  const h = await headers();
  const who = cookieAccess(h);
  if (who && "role" in who) {
    if (who.role === "owner") return <HqApp token={getToken()} ui={uiVersion()} />;
    return <GuestApp role={who.role} label={who.guest.label} until={who.guest.until} />;
  }
  if (who && "github" in who) {
    return (
      <main className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        <div className="flex max-w-md flex-col items-center gap-5">
          <p>
            Link chia sẻ này dành cho tài khoản GitHub <span className="font-medium text-foreground">@{who.github}</span>: đăng nhập GitHub để vào, hoặc <Leave />.
          </p>
          <GithubLogin />
        </div>
      </main>
    );
  }
  if (who && "error" in who) {
    return (
      <main className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        <p className="max-w-md">
          {who.error} Hoặc <Leave />.
        </p>
      </main>
    );
  }
  const pub = readPublic();
  const onPublic = !!pub && h.get("host")?.toLowerCase() === pub.host;
  return (
    <main className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
      {onPublic ? (
        <div className="flex flex-col items-center gap-5">
          {!!readGithubConfig()?.allow.length && <GithubLogin />}
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
        </div>
      ) : (
        <p>HQ only answers on 127.0.0.1.</p>
      )}
    </main>
  );
}
