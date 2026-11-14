"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut, googleConfigured } from "@/lib/auth/config";
import { getScanSubject } from "@/lib/auth/subject";

import { CONSENT_COOKIE } from "@/lib/auth/consent";

export async function signInWithGoogle() {
  if (!googleConfigured) redirect("/");
  await signIn("google", { redirectTo: "/consent" });
}

/** Records consent for this browser session (cookie expires when the browser closes). */
export async function grantConsent() {
  if (!(await getScanSubject())) redirect("/");
  (await cookies()).set(CONSENT_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/scan");
}

export async function leave() {
  (await cookies()).delete(CONSENT_COOKIE);
  if (googleConfigured) await signOut({ redirectTo: "/" });
  redirect("/");
}
