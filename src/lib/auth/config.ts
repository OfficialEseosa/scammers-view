import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/** True only when real Google sign-in can work. */
export const googleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.AUTH_SECRET,
);

const isDev = process.env.NODE_ENV === "development";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: googleConfigured
    ? [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        }),
      ]
    : [],
  // Without Google configured the app only runs in development; the
  // placeholder secret is never used for anything but an empty provider list.
  secret: process.env.AUTH_SECRET ?? (isDev ? "dev-only-placeholder" : undefined),
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/", error: "/" },
  callbacks: {
    // Only accept Google accounts whose email Google has verified.
    signIn({ account, profile }) {
      if (account?.provider === "google") return profile?.email_verified === true;
      return false;
    },
  },
});
