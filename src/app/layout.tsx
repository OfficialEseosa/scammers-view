import type { Metadata, Viewport } from "next";
import { Fragment_Mono } from "next/font/google";
import { ThemeScript } from "@/design/ThemeScript";
import "./globals.css";

// Evidence face (OFL, self-hosted by next/font at build time).
const evidence = Fragment_Mono({
  variable: "--font-fragment-mono",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// Clash Display + Switzer are ITF Free Font License fonts: loaded from Fontshare's own CDN, never committed.
const FONTSHARE = [
  "https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap",
  "https://api.fontshare.com/v2/css?f[]=switzer@400,500,600,700&display=swap",
];

export const metadata: Metadata = {
  title: "Scammer's View",
  description: "See yourself the way a scammer does. Then fix it.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${evidence.variable} h-full`} suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
        {FONTSHARE.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
