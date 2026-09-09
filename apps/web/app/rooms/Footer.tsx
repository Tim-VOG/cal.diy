import Link from "next/link";

/**
 * Site-wide footer for the NATO Edge 26 rooms platform.
 *
 * The layout, the classes and the columns are fixed. What is NOT fixed is which
 * pages the last two columns list: those used to be two hard-coded hrefs, so a
 * page created in the admin was reachable only by typing its URL. They now come
 * from the pages themselves, each carrying the column it belongs in and its
 * position within it — and the migration wrote those onto the two existing
 * pages, so what renders here is unchanged until somebody changes it.
 *
 * The spacing rule is reproduced exactly: the first entry in a column sits at
 * mt-3, everything after it at mt-2.
 *
 * The pages arrive as a prop rather than being read here: the layout is already
 * an async server component and this one is nested inside it, which React's
 * types in this version refuse to accept as JSX.
 */

export interface FooterPage {
  slug: string;
  title: string;
  footerColumn: string | null;
}

const linkClass = "block text-sm text-white/80 underline transition hover:text-white";

export default function Footer({ pages }: { pages: FooterPage[] }): JSX.Element {
  const column = (name: string) => pages.filter((p) => p.footerColumn === name);

  return (
    <footer className="mt-16 bg-black text-white">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <p className="text-sm text-white/70">
          VO Europe SA, Rue Haute 139, 1000 Brussels, Belgium — BCE / VAT BE 0849 627 948.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col items-start gap-4">
            {/* Both logos are white-on-transparent, so they read on the black footer. */}
            {/* biome-ignore lint/performance/noImgElement: static brand asset, next/image adds no value here */}
            <img src="/VOEU.png" alt="VO Europe" className="h-8 w-auto" />
            {/* biome-ignore lint/performance/noImgElement: static brand asset, next/image adds no value here */}
            <img src="/NE26.png" alt="NATO Edge 26" className="h-10 w-auto" />
          </div>

          <div>
            <h2 className="font-semibold text-base">Contact</h2>
            <a href="mailto:Sales-NatoEdge@vo-europe.eu" className={`mt-3 ${linkClass}`}>
              Sales-NatoEdge@vo-europe.eu
            </a>
          </div>

          <div>
            <h2 className="font-semibold text-base">Privacy</h2>
            {column("privacy").map((page, i) => (
              <Link
                key={page.slug}
                href={`/rooms/legal/${page.slug}`}
                className={`${i === 0 ? "mt-3" : "mt-2"} ${linkClass}`}>
                {page.title}
              </Link>
            ))}
            <a
              href="mailto:privacy@vo-europe.eu"
              className={`${column("privacy").length === 0 ? "mt-3" : "mt-2"} ${linkClass}`}>
              privacy@vo-europe.eu
            </a>
          </div>

          <div>
            <h2 className="font-semibold text-base">More</h2>
            {column("more").map((page, i) => (
              <Link
                key={page.slug}
                href={`/rooms/legal/${page.slug}`}
                className={`${i === 0 ? "mt-3" : "mt-2"} ${linkClass}`}>
                {page.title}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
