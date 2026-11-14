import type { MetadataRoute } from "next";

/**
 * Makes the app installable, and puts "Scammer's View" in Android's share sheet so a
 * suspicious text, link or screenshot can be shared straight into the checker.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/check",
    name: "Scammer's View",
    short_name: "Scam check",
    description: "Check a suspicious message, and see yourself the way a scammer does.",
    start_url: "/check",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: {
      action: "/check/share",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "shot", accept: ["image/*"] }],
      },
    },
  };
}
