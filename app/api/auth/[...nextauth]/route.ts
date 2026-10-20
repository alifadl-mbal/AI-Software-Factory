import type { NextRequest } from "next/server";

import { handlers } from "@/auth";
import { authEnabled } from "@/lib/server/access";

/** Auth.js endpoints (sign-in redirect, Microsoft callback, sign-out). 404 while sign-in is off. */
function route(handler: (request: NextRequest) => Promise<Response>) {
  return (request: NextRequest) =>
    authEnabled()
      ? handler(request)
      : Response.json({ ok: false, message: "Sign-in is off." }, { status: 404 });
}

export const GET = route(handlers.GET);
export const POST = route(handlers.POST);
