import type { MetadataRoute } from "next";

/**
 * Lets phones and tablets add the workspace to the home screen. There is no
 * service worker on purpose: installing needs none, and caching signed-in
 * business data on a phone that may be shared is not worth it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "BJH Logistics",
    short_name: "BJH",
    description:
      "Quotes, jobs, shipments and documents for BJH Logistics staff and customers.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f4f8fc",
    theme_color: "#0b3fae",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
