import { Navigate, useParams } from 'react-router-dom';
import { PromoPage, PromoSection } from '@/components/sections/PromoLayout';
import { Skeleton } from '@/components/ui/Skeleton';
import { sanitizeHtml } from '@/lib/sanitizeHtml';
import { usePromotion } from '@/queries';

/**
 * `/promotions/:segment/:slug` — one operator promotion
 * (`GET /admin/promotions/slug/:segment/:slug`), in the shared promo chrome.
 *
 * `description` and `termsHtml` are staff-written HTML on a public route, so
 * both go through `lib/sanitizeHtml` before `dangerouslySetInnerHTML`, as the
 * blog does.
 */
const PROSE =
  'grid gap-4 text-base leading-6 text-bulma [&_a]:text-piccolo [&_a]:underline ' +
  '[&_h2]:text-xl [&_h3]:text-lg [&_h3]:font-medium [&_ol]:list-decimal [&_ol]:ps-6 [&_ul]:list-disc [&_ul]:ps-6';

export function PromotionDetail() {
  const { segment, slug } = useParams();
  const { data, isPending, isError } = usePromotion(segment, slug);

  if (isPending) return <Skeleton className="h-[290px] max-w-[700px] rounded" />;
  // A stale or unpublished link: the list is the useful answer, as `promotions/:slug` does.
  if (isError || !data) return <Navigate to="/promotions" replace />;

  const body = sanitizeHtml(data.description);
  const terms = sanitizeHtml(data.termsHtml);

  return (
    <PromoPage
      promo={{
        slug: `${data.segment}-${data.slug}`,
        title: data.title,
        art: data.imageUrl ?? '/images/banners/league.svg',
      }}
    >
      {data.endsAt && (
        <p className="text-sm text-trunks">
          {data.promoStatus === 'ended' ? 'Ended' : 'Ends'}{' '}
          {new Date(data.endsAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>
      )}

      {body ?
        <div className={PROSE} dangerouslySetInnerHTML={{ __html: body }} />
      : data.summary && <p className="text-base leading-6 text-bulma">{data.summary}</p>}

      {terms && (
        <PromoSection heading="Terms & Conditions">
          <div className={`mt-4 ${PROSE}`} dangerouslySetInnerHTML={{ __html: terms }} />
        </PromoSection>
      )}
    </PromoPage>
  );
}
