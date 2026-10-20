import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { isDemoEmail, demoMayRequest } from "@/lib/demo";

export const authConfig: NextAuthConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize() {
        return null;
      },
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      // Redirect authenticated users away from auth pages to dashboard
      const authPages = ["/login", "/signup", "/forgot-password"];
      if (auth?.user && authPages.some((r) => pathname.startsWith(r))) {
        return Response.redirect(new URL("/dashboard", request.url));
      }

      const publicRoutes = [
        "/login",
        "/signup",
        "/forgot-password",
        "/reset-password",
        "/api/auth",
        "/api/signout",
        "/api/onboarding/finalize", // internal, secret-gated (called by bg function)
        "/api/widget",
        "/api/portal",
        "/api/invitations/accept",
        "/portal",
        "/invite",
        "/intake",
        "/api/intake",
        "/api/cron",
        "/demo",
      ];
      // The shared demo login is public, so it gets read-only access.
      if (
        isDemoEmail(auth?.user?.email) &&
        !demoMayRequest(request.method, pathname, request.headers.has("next-action"))
      ) {
        return Response.json(
          { error: "The demo is read-only. Sign up for free to try this." },
          { status: 403 }
        );
      }

      const isPublic = publicRoutes.some((r) => pathname.startsWith(r));
      if (isPublic) return true;
      return !!auth?.user;
    },
    async jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) session.user.id = token.id as string;
      return session;
    },
  },
};
