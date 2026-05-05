import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { isHttpsRequest } from "./lib/auth/utils";
import { guestRegex } from "./lib/constants";

/**
 * Social-card crawlers (Twitterbot, Slackbot, facebookexternalhit, etc.)
 * don't carry cookies, so the guest-auth redirect loop traps them and
 * they never reach an HTML response that emits og: meta tags. Match
 * common crawler UAs and let them through with a sessionless render —
 * the chat root layout uses `session?.user` everywhere, so a missing
 * session is safe. Bots have no business hitting `/api/*` anyway, so
 * the bypass is gated to non-API paths.
 */
const BOT_UA_REGEX =
  /bot|facebookexternalhit|slackbot|linkedinbot|twitterbot|whatsapp|telegram|discordbot|preview|crawl|spider|googlebot|bingbot|applebot|embedly|skypeuripreview|opengraph/i;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    process.env.NODE_ENV === "development" &&
    pathname.startsWith("/tidewave")
  ) {
    return NextResponse.rewrite(new URL("/api/tidewave", request.url));
  }

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Crawler bypass — done before `getToken()` so we save the JWT verify too.
  if (!pathname.startsWith("/api/")) {
    const ua = request.headers.get("user-agent") ?? "";
    if (BOT_UA_REGEX.test(ua)) {
      return NextResponse.next();
    }
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: isHttpsRequest(request),
  });

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  if (!token) {
    const redirectUrl = encodeURIComponent(new URL(request.url).pathname);

    return NextResponse.redirect(
      new URL(`${base}/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  const isGuest = guestRegex.test(token?.email ?? "");

  if (token && !isGuest && pathname === "/login") {
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",

    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|opengraph-image).*)",
  ],
};
