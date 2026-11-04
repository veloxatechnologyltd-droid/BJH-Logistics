import type { MetadataRoute } from "next";
import { CONTENT_UPDATED } from "./content.ts";
import { absoluteUrl, sitePaths } from "./seo.ts";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitePaths.map((path) => ({
    url: absoluteUrl(path),
    lastModified: CONTENT_UPDATED,
  }));
}
