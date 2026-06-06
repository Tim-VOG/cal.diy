import Link from "next/link";

// Site-wide footer for the NATO Edge 26 rooms platform. Static brand + legal
// links; the two legal links resolve to admin-managed pages under /rooms/legal.
export default function Footer(): JSX.Element {
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
            <a
              href="mailto:Sales-NatoEdge@vo-europe.eu"
              className="mt-3 block text-sm text-white/80 underline transition hover:text-white">
              Sales-NatoEdge@vo-europe.eu
            </a>
          </div>

          <div>
            <h2 className="font-semibold text-base">Privacy</h2>
            <Link
              href="/rooms/legal/privacy-policy"
              className="mt-3 block text-sm text-white/80 underline transition hover:text-white">
              Privacy Policy
            </Link>
            <a
              href="mailto:privacy@vo-europe.eu"
              className="mt-2 block text-sm text-white/80 underline transition hover:text-white">
              privacy@vo-europe.eu
            </a>
          </div>

          <div>
            <h2 className="font-semibold text-base">More</h2>
            <Link
              href="/rooms/legal/practical-information"
              className="mt-3 block text-sm text-white/80 underline transition hover:text-white">
              Practical Information &amp; Legal Framework
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
