import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Perkkeep",
    short_name: "Perkkeep",
    description: "Your card benefits, kept in view.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#f6f5f1",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
