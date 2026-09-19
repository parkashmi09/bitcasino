import { Link, Navigate, useParams } from 'react-router-dom';
import { HelpCategoriesSidebar } from '@/components/sections/HelpCategoriesSidebar';
import { findHelpCategory } from '@/data/helpArticles';

function RichText({ parts }) {
  return parts.map((part, index) => {
    if (part.href) {
      const isMailto = /^mailto:/i.test(part.href);
      const isExternal = isMailto || /^https?:\/\//i.test(part.href);
      if (isExternal) {
        return <a key={index} href={part.href} {...(isMailto ? {} : { target: '_blank', rel: 'noreferrer' })} className="font-bold underline hover:text-piccolo">{part.linkLabel}</a>;
      }
      return <Link key={index} to={part.href} className="font-bold underline hover:text-piccolo">{part.linkLabel}</Link>;
    }
    if (part.bold) return <strong key={index}>{part.bold}</strong>;
    return <span key={index}>{part.text}</span>;
  });
}

function ListItemContent({ item }) {
  if (typeof item === 'string') return item;
  const main = item.parts
    ? <RichText parts={item.parts} />
    : (
      <>
        {item.bold ? <><strong>{item.bold}</strong><br /></> : null}
        {item.prefix}
        {item.href ? <Link to={item.href} className="font-bold underline hover:text-piccolo">{item.linkLabel}</Link> : null}
        {item.suffix ?? item.text}
        {item.note ? <><br /><em>{item.note}</em></> : null}
      </>
    );
  if (!item.children?.length) return main;
  const ChildList = item.childList === 'ul' ? 'ul' : 'ol';
  const childClassName = item.childList === 'ul'
    ? 'mt-2 list-disc space-y-2 ps-7'
    : 'mt-2 list-[lower-alpha] space-y-2 ps-7';
  return (
    <>
      {main}
      <ChildList className={childClassName}>
        {item.children.map((child, childIndex) => (
          <li key={childIndex}><ListItemContent item={child} /></li>
        ))}
      </ChildList>
    </>
  );
}

function ContentBlocks({ blocks }) {
  return blocks.map((block, index) => {
    if (block.type === 'heading') return <h2 key={index}>{block.value}</h2>;
    if (block.type === 'image') return <div key={index} className="banner-image py-4"><img src={block.src} alt={block.alt || ''} width="850" height="850" className="h-auto max-w-full" loading="lazy" /></div>;
    if (block.type === 'subheading') return <h3 key={index}>{block.value}</h3>;
    if (block.type === 'list') return <ul key={index}>{block.values.map((value, itemIndex) => <li key={itemIndex}><ListItemContent item={value} /></li>)}</ul>;
    if (block.type === 'ordered-list') {
      return (
        <ol key={index} className="list-decimal space-y-2 ps-7">
          {block.values.map((value, itemIndex) => (
            <li key={itemIndex} className={value?.table ? 'space-y-4' : undefined}>
              <ListItemContent item={value} />
              {value?.table ? (
                <div className="table-wrapper overflow-x-auto">
                  <table className="min-w-full border-collapse text-left text-sm">
                    <thead className="bg-gohan">
                      <tr>{value.table.headers.map((header) => <th key={header} className="border border-beerus px-3 py-2 font-bold">{header}</th>)}</tr>
                    </thead>
                    <tbody>
                      {value.table.rows.map((row) => (
                        <tr key={row[0]}>{row.map((cell) => <td key={cell} className="border border-beerus px-3 py-2">{cell}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      );
    }
    if (block.type === 'procedure') {
      return (
        <ol key={index} className="list-decimal space-y-4 ps-7">
          {block.values.map((item, itemIndex) => (
            <li key={itemIndex} className="space-y-4">
              <ListItemContent item={typeof item === 'string' ? item : { parts: item.parts, text: item.text, bold: item.bold, prefix: item.prefix, href: item.href, linkLabel: item.linkLabel, suffix: item.suffix, note: item.note }} />
              {item.image ? <img src={item.image} alt={item.alt || ''} width="850" height="850" className="h-auto max-w-full" loading="lazy" /> : null}
              {item.images?.map((src) => <img key={src} src={src} alt={item.alt || ''} width="850" height="850" className="h-auto max-w-full" loading="lazy" />)}
            </li>
          ))}
        </ol>
      );
    }
    if (block.type === 'external-links') return <ul key={index}>{block.links.map(([label, href]) => <li key={href}><a href={href} target="_blank" rel="noreferrer" className="underline hover:text-piccolo">{label}</a></li>)}</ul>;
    if (block.type === 'notice') return <p key={index}><strong>{block.prefix}<Link to={block.href} className="underline hover:text-piccolo">{block.linkLabel}</Link>{block.suffix}</strong></p>;
    if (block.type === 'link-paragraph') return <p key={index}>{block.prefix}<Link to={block.href} className="font-bold underline hover:text-piccolo">{block.linkLabel}</Link>{block.suffix}</p>;
    if (block.type === 'rich-paragraph') return <p key={index}><RichText parts={block.parts} /></p>;
    if (block.type === 'code') return <pre key={index}><code>{block.value}</code></pre>;
    if (block.type === 'video') return <div key={index} className="relative aspect-video"><iframe src={block.src} title={block.title} allow="autoplay; fullscreen; picture-in-picture; clipboard-write" className="absolute inset-0 h-full w-full" allowFullScreen /></div>;
    if (block.type === 'step') return <div key={index} className="space-y-4"><p><strong>Step {index}:</strong> {block.value}</p><img src={block.image} alt={`Step ${index}`} width="850" height="850" className="h-auto max-w-full" loading="lazy" /></div>;
    if (block.type === 'table') return <div key={index} className="table-wrapper overflow-x-auto"><table className="min-w-full border-collapse text-left text-sm"><thead className="bg-gohan"><tr>{block.headers.map((header) => <th key={header} className="border border-beerus px-3 py-2 font-bold">{header}</th>)}</tr></thead><tbody>{block.rows.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell} className="border border-beerus px-3 py-2">{cell}</td>)}</tr>)}</tbody></table></div>;
    if (block.type === 'details') {
      return (
        <details key={index} open={block.open !== false} className="rounded-md border border-beerus px-4 py-3">
          <summary className="cursor-pointer text-xl font-medium text-bulma">{block.title}</summary>
          <div className="mt-4 space-y-4">{ContentBlocks({ blocks: block.content || [] })}</div>
        </details>
      );
    }
    return <p key={index}>{block.value}</p>;
  });
}

function ArticleContent({ article }) {
  if (!article.content) return <div className="mt-8 space-y-4">{article.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>;
  return <div className="mt-8 space-y-4 [&_h2]:mb-4 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:leading-7 [&_h3]:mt-7 [&_h3]:text-lg [&_h3]:font-bold [&_pre]:overflow-x-auto [&_pre]:bg-gohan [&_pre]:p-4 [&_pre]:text-sm [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:ps-7">
    {ContentBlocks({ blocks: article.content })}
  </div>;
}

function HelpFooter() {
  return <section className="mt-10 max-w-[596px] border-t border-beerus pt-8"><h2 className="text-2xl font-bold text-bulma">Other ways to get help</h2><a href="mailto:hello@bitcasino.io" className="mt-4 flex items-center gap-4 bg-gohan px-6 py-4 text-bulma hover:bg-beerus"><span aria-hidden="true" className="text-4xl leading-none">@</span><span><strong className="block text-xl">Email us</strong><span className="text-sm text-trunks">hello@bitcasino.io</span></span></a></section>;
}

export function HelpArticle() {
  const { categorySlug, articleSlug } = useParams();
  const category = findHelpCategory(categorySlug);
  const article = category?.articles.find((item) => item.slug === articleSlug);
  if (!category || !article?.slug) return <Navigate to="/help-center" replace />;
  const relatedArticles = category.articles.filter((item) => item.slug && item.slug !== article.slug).slice(0, 3);
  return <div className="w-full max-w-[99rem] overflow-x-clip md:mx-auto"><nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma"><Link to="/" className="hover:text-piccolo">Bitcasino</Link><span>›</span><Link to="/help-center" className="hover:text-piccolo">Help centre</Link><span>›</span><Link to={`/help-center/${category.slug}`} className="hover:text-piccolo">{category.title}</Link><span>›</span><span>{article.title}</span></nav><div className="mt-8 grid gap-10 md:grid-cols-[minmax(0,1fr)_280px] md:gap-8 lg:grid-cols-[minmax(0,800px)_280px] lg:justify-between"><article className="min-w-0 max-w-[800px] text-[15px] leading-6 text-bulma md:text-base md:leading-7"><p className="mb-2 text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">{category.title}</p><h1 className="font-primary text-2xl font-bold leading-8 text-bulma">{article.title}</h1><ArticleContent article={article} /></article><HelpCategoriesSidebar /></div><section className="mt-14 border-t border-beerus pt-8"><h2 className="mb-5 text-2xl font-bold text-bulma">Related articles</h2><div className="grid gap-6 md:grid-cols-3">{relatedArticles.map((item) => <Link key={item.slug} to={`/help-center/${category.slug}/${item.slug}`} className="text-xl text-bulma hover:text-piccolo"><span className="mb-1 block text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">{category.title}</span>{item.title}</Link>)}</div></section><HelpFooter /></div>;
}
