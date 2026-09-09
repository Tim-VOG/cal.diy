import { getNe26LegalPageRepository } from "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container";
import { markdownToSafeHTML } from "@calcom/lib/markdownToSafeHTML";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await getNe26LegalPageRepository().findPublishedBySlug(slug);
  if (!page) return { title: "Not found" };
  return { title: `${page.title} · NATO Edge 26` };
}

export default async function LegalPage({ params }: PageProps): Promise<JSX.Element> {
  const { slug } = await params;
  const page = await getNe26LegalPageRepository().findPublishedBySlug(slug);
  if (!page) notFound();

  // A page can be a signpost rather than a document: for the ones whose real
  // content is a PDF somebody else maintains, copying it into Markdown would
  // only guarantee the two drift apart. The footer links here either way, so
  // nothing else has to know which kind a page is.
  //
  // Re-checked for http(s) here as well as on save. This value goes into a
  // Location header, and the check that put it there is a schema somebody could
  // one day relax; the one that matters is the one next to the redirect.
  if (page.externalUrl && /^https?:\/\//i.test(page.externalUrl)) {
    redirect(page.externalUrl);
  }

  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="font-bold text-3xl text-[#000643]">{page.title}</h1>
      {/* Styled here, element by element, rather than with `prose`: the
          typography plugin is installed but never registered with Tailwind, so
          those classes rendered nothing. Tailwind's preflight resets headings
          to the size and weight of body text, which meant an H1 written by an
          admin came out looking exactly like a paragraph — a formatting button
          that silently does nothing is worse than no button. Bullets get their
          own inline styles from markdownToSafeHTML. */}
      <div
        className="mt-6 max-w-none text-gray-800 leading-relaxed [&_a]:text-[#000643] [&_a]:underline [&_blockquote]:mt-3 [&_blockquote]:border-gray-200 [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-gray-600 [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_h1]:mt-8 [&_h1]:font-bold [&_h1]:text-2xl [&_h1]:text-[#000643] [&_h2]:mt-6 [&_h2]:font-semibold [&_h2]:text-[#000643] [&_h2]:text-xl [&_h3]:mt-5 [&_h3]:font-semibold [&_h3]:text-[#000643] [&_h3]:text-base [&_hr]:my-6 [&_hr]:border-gray-200 [&_li]:mt-1 [&_ol]:mt-3 [&_p]:mt-3 [&_strong]:font-semibold [&_strong]:text-gray-900 [&_ul]:mt-3"
        // Sanitized server-side by markdownToSafeHTML (sanitize-html).
        // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized HTML from trusted admin Markdown
        dangerouslySetInnerHTML={{ __html: markdownToSafeHTML(page.content) }}
      />
    </article>
  );
}
