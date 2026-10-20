import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

import { allowedGroup, groupAllows, SESSION_MAX_AGE_SECONDS, SIGN_IN_PATH } from "@/lib/server/access";

/**
 * Microsoft sign-in (Auth.js v5, Entra ID, MBAL's tenant only).
 *
 * Sessions are stateless JWTs in an encrypted, httpOnly, sameSite=lax cookie, `secure` unless
 * `AUTH_URL` is plain http (local testing only). They end one working day after sign-in, however
 * active the user is. The config is built lazily, so nothing here runs while sign-in is off (see
 * `authEnabled`): callers check that first.
 */

declare module "next-auth" {
  interface Session {
    /** Passes the `AUTH_ALLOWED_GROUP` check (always true when no group is configured). */
    allowed: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    signedInAt?: number;
    /** The configured group, if the user was a member of it at sign-in. Never the full list. */
    groups?: string[];
  }
}

interface EntraProfile {
  sub?: string;
  oid?: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  groups?: unknown;
  _claim_names?: { groups?: string };
}

function config(): NextAuthConfig {
  const tenant = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
  return {
    providers: [
      MicrosoftEntraID({
        clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        // Single tenant: only accounts in MBAL's directory can sign in.
        issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
        // The default profile also fetches the user's photo into the cookie; we only need names.
        profile(profile: EntraProfile) {
          return {
            id: profile.oid ?? profile.sub,
            name: profile.name ?? null,
            email: profile.email ?? profile.preferred_username ?? null,
            image: null,
          };
        },
      }),
    ],
    pages: { signIn: SIGN_IN_PATH, error: SIGN_IN_PATH },
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
    useSecureCookies: !process.env.AUTH_URL?.startsWith("http://"),
    // The app sits behind the office HTTPS reverse proxy, which sets X-Forwarded-Host/Proto.
    trustHost: true,
    callbacks: {
      jwt({ token, profile }) {
        if (profile) {
          const claims = profile as EntraProfile;
          const group = allowedGroup();
          token.signedInAt = Date.now();
          token.groups = group && groupAllows(group, claims.groups) ? [group] : [];
          if (group && claims._claim_names?.groups) {
            console.warn(
              "[mbal-bi] the sign-in token lists too many groups to check AUTH_ALLOWED_GROUP; " +
                'set the app registration\'s groups claim to "Groups assigned to the application".',
            );
          }
        }
        // An absolute lifetime: a busy session is not extended past one working day.
        if (!token.signedInAt || Date.now() - token.signedInAt > SESSION_MAX_AGE_SECONDS * 1000) {
          return null;
        }
        return token;
      },
      session({ session, token }) {
        return {
          ...session,
          user: { ...session.user, name: token.name ?? null, email: token.email ?? "" },
          allowed: groupAllows(allowedGroup(), token.groups),
        };
      },
    },
    events: {
      // Who and when, nothing else: never tokens or claims.
      signIn({ user }) {
        console.info(
          `[mbal-bi] sign-in: ${user.email ?? user.name ?? "unknown user"} at ${new Date().toISOString()}`,
        );
      },
    },
  };
}

export const { auth, handlers, signIn, signOut } = NextAuth(() => config());
