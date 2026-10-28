import type { MetadataRoute } from "next";
import { SITE_URL } from "./content";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    "",
    "/services",
    "/projects",
    "/about",
    "/contact",
    "/request-a-quote",
  ].map((path) => ({ url: `${SITE_URL}${path}` }));
}
