# Site SEO runbook

What the code does (see `app/seo.ts`, `app/serviceDetails.ts`, `app/sitemap.ts`,
`app/robots.ts`, `app/llms.txt/route.ts`) and what only people can do.

## After every deploy

1. In Vercel, `NEXT_PUBLIC_SITE_URL` must be unset or `https://www.bjhlogistics.com`.
   The apex redirects to `www`; an apex value puts redirecting URLs in the sitemap.
2. Open `/robots.txt`, `/sitemap.xml` (17 URLs, all `www`) and `/llms.txt`.
3. Run Google's Rich Results Test and the Schema Markup Validator on the home
   page and one `/services/...` page. Not run yet: it needs the live URL.
4. In the Vercel firewall, make sure no bot rule blocks Googlebot, Bingbot,
   GPTBot, OAI-SearchBot, ClaudeBot or PerplexityBot.

## One-time work for BJH (the biggest ranking levers; none is code)

- **Google Business Profile:** claim and verify the Tema office. Use the same
  name, address and phone numbers as the site, the `www` address, photos and
  the service list. This matters most for "freight forwarder Tema" searches.
- **Search Console and Bing Webmaster Tools:** add the site, submit
  `/sitemap.xml`, watch which searches show it.
- **Old addresses:** the 2026-10-28 rebuild replaced the old site. Search
  `site:bjhlogistics.com` in Google; any old URL that now 404s should redirect
  to its closest new page so its ranking carries over.
- **Reviews:** ask real customers to review the Google profile and reply to
  each. Do not add review or rating markup to the site: self-published review
  markup is against Google's guidelines, and none exists in the code on purpose.
- **Listings and links:** keep name, address and phone identical on LinkedIn,
  Facebook, GIFF, Freightnet and Ghana business directories, each linking to
  the `www` site. Links from trade press, customers and associations count most.

## What BJH should supply (so the pages can beat directory listings)

- Whether BJH holds a customs clearing licence, and its GIFF, FIATA and IATA
  membership status. Until confirmed the site says neither "licensed" nor
  "member"; once confirmed, `memberOf` markup and "clearing agent" wording can
  be added.
- Per service: lanes served, typical transit times, real photos of operations
  and one or two short case studies (customer names only with permission).
- The same detail for the 6 services without a page: container sales, cargo
  insurance, licence support, scrap metal, offshore supply, import/export
  support. Add an entry to `serviceDetails.ts` and the page, the sitemap and
  `llms.txt` follow automatically.
- Facts for guides people actually search, such as the documents needed to
  clear a container at Tema Port or shipping a vehicle to Ghana. These are what
  AI assistants quote. They need BJH review because they describe Ghanaian
  customs practice.

## Keeping it consistent

- New page: use `pageMetadata()`, add the path to `sitePaths` in `seo.ts`.
- Titles: page part at most 44 characters; descriptions 70 to 155. Tests check
  this for service pages.
- Bump `CONTENT_UPDATED` in `content.ts` when copy changes materially.
- No superlatives, prices, ratings or credentials BJH has not published.
  `app/seo.test.ts` blocks the common ones.
- `llms.txt` is built from `content.ts`. Support for it among AI providers is
  not confirmed, so treat it as a cheap extra; the page text and structured
  data carry the weight.
