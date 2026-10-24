import { Link, Navigate, useParams } from 'react-router-dom';
import { findHelpCategory } from '@/data/helpArticles';

export function HelpCategory() {
  const { categorySlug } = useParams();
  const category = findHelpCategory(categorySlug);
  if (!category) return <Navigate to="/help-center" replace />;
  return <div className="w-full max-w-[99rem] overflow-x-clip"><div className="grid gap-6"><nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-bulma"><Link to="/" className="hover:text-piccolo">Bitcasino</Link><span>›</span><Link to="/help-center" className="hover:text-piccolo">Help centre</Link><span>›</span><span>{category.title}</span></nav><header className="grid gap-1"><span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Help Centre</span><h1 className="font-primary text-2xl font-normal leading-8 text-bulma">{category.title}</h1></header><section className="grid grid-cols-1 gap-4 pb-6 md:grid-cols-3">{category.articles.map((article) => <div key={article.slug} className="grid self-start gap-1"><span className="text-[10px] uppercase leading-4 tracking-[0.5px] text-trunks">Support</span><Link to={`/help-center/${category.slug}/${article.slug}`} className="text-xl leading-8 text-bulma transition-colors hover:text-piccolo">{article.title}</Link></div>)}</section></div></div>;
}
