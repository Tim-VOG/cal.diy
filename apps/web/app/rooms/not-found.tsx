import NotFoundPanel from "./NotFoundPanel";

/**
 * Anything under /rooms that does not resolve lands here.
 *
 * A mistyped room slug matches the [slug] route, finds no room and calls
 * notFound(). Rendered inside the rooms layout, so it keeps the header and
 * footer; the root 404 renders the same panel on its own.
 */
export default function RoomsNotFound(): JSX.Element {
  return <NotFoundPanel />;
}
