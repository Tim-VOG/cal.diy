import PageWrapper from "@components/PageWrapperAppDir";
import { _generateMetadata } from "app/_utils";
import { headers } from "next/headers";
import NotFoundPanel from "./rooms/NotFoundPanel";

export const generateMetadata = async () => {
  const metadata = await _generateMetadata(
    (t) => t("404_page_not_found"),
    (t) => t("404_page_not_found")
  );
  return {
    ...metadata,
    robots: {
      index: false,
      follow: false,
    },
  };
};

/**
 * The 404 for anything OUTSIDE /rooms — a mistyped link from an email, a stale
 * bookmark, the address bar.
 *
 * Cal's own 404 used to answer here, and it is a marketing page: it reads the
 * mistyped path as a username, tells the visitor it "is still available", and
 * offers them Cal's documentation and blog. Nothing on it says NATO Edge, and
 * nothing on it leads back into the booking. This installation sells nine
 * meeting rooms and has no marketing surface, so it shows the same panel
 * /rooms already shows.
 */
const ServerPage = async () => {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;

  return (
    <PageWrapper requiresLicense={false} nonce={nonce}>
      <div className="flex min-h-screen items-center justify-center bg-white px-4">
        <NotFoundPanel />
      </div>
    </PageWrapper>
  );
};
export default ServerPage;
