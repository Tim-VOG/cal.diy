import { getNe26LegalPageRepository } from "@calcom/features/ne26-rooms/di/Ne26LegalPageRepository.container";
import { markdownToSafeHTML } from "@calcom/lib/markdownToSafeHTML";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

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

  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="font-bold text-3xl text-[#000643]">{page.title}</h1>
      <div
        className="prose prose-sm mt-6 max-w-none text-gray-800 leading-relaxed [&_a]:text-[#000643] [&_a]:underline [&_h2]:mt-6 [&_h2]:font-semibold [&_h2]:text-[#000643] [&_h2]:text-xl [&_p]:mt-3"
        // Sanitized server-side by markdownToSafeHTML (sanitize-html).
        // biome-ignore lint/security/noDangerouslySetInnerHtml: content is sanitized HTML from trusted admin Markdown
        dangerouslySetInnerHTML={{ __html: markdownToSafeHTML(page.content) }}
      />
    </article>
  );
}
