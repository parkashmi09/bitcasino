import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Home } from '@/pages/Home';
import { Category } from '@/pages/Category';
import { Theme } from '@/pages/Theme';
import { Recent } from '@/pages/Recent';
import { Providers } from '@/pages/Providers';
import { Provider } from '@/pages/Provider';
import { Play } from '@/pages/Play';
import { Login } from '@/pages/Login';
import { SignUp } from '@/pages/SignUp';
import { ForgotPassword } from '@/pages/ForgotPassword';
import { NotFound } from '@/pages/NotFound';
import { ProfileLayout } from '@/pages/ProfileLayout';
import { Notifications } from '@/pages/Notifications';
import { Rewards } from '@/pages/Rewards';
import { Account } from '@/pages/Account';
import { Boosts } from '@/pages/Boosts';
import { Security } from '@/pages/Security';
import { Refer } from '@/pages/Refer';
import { Loyalty } from '@/pages/Loyalty';
import { Settings } from '@/pages/Settings';
import { Transactions } from '@/pages/Transactions';
import { Blog } from '@/pages/Blog';
import { BlogPost } from '@/pages/BlogPost';
import { Promotions } from '@/pages/Promotions';
import { Participations } from '@/pages/Participations';
import { League } from '@/pages/League';
import { WeeklyRakeback } from '@/pages/WeeklyRakeback';
import { SpinWheel } from '@/pages/SpinWheel';
import { Vip } from '@/pages/Vip';
import { Tournaments } from '@/pages/Tournaments';
import { TournamentList } from '@/pages/TournamentList';
import { TermsAndConditions } from '@/pages/TermsAndConditions';
import { ResponsibleGaming } from '@/pages/ResponsibleGaming';
import { SelfExclusion } from '@/pages/SelfExclusion';
import { DisputeResolution } from '@/pages/DisputeResolution';
import { AmlPolicy } from '@/pages/AmlPolicy';
import { ProvablyFair } from '@/pages/ProvablyFair';
import { RewardTerms } from '@/pages/RewardTerms';
import { PrivacyPolicy } from '@/pages/PrivacyPolicy';
import { BitcoinBreakdown } from '@/pages/BitcoinBreakdown';
import { HelpCenter } from '@/pages/HelpCenter';
import { HelpCategory } from '@/pages/HelpCategory';
import { HelpArticle } from '@/pages/HelpArticle';
import { OurLicense } from '@/pages/OurLicense';
import { ScrollToTop } from '@/components/layout/ScrollToTop';
import { RouteProgress } from '@/components/layout/RouteProgress';
import { AuthProvider } from '@/auth/AuthProvider';
import { RedirectIfAuthenticated, RequireAuth } from '@/auth/guards';

/**
 * `AuthProvider` sits inside the router rather than around it, for one reason:
 * every screen that reads the session is a route, and the provider's own
 * bootstrap — exchange the stored refresh token, then read `/me` — is what the
 * guards below wait on. Outside the router it would work identically and be one
 * more thing to reason about; inside, the session and the routes have the same
 * lifetime.
 */
/**
 * `/ref/:code` — a redirect, not a page.
 *
 * `replace` so the back button leaves the site rather than bouncing the
 * visitor between the referral URL and the form it forwards to.
 * `encodeURIComponent` because the code arrives from a URL somebody else
 * pasted, and it is about to become a query parameter.
 */
function ReferralLanding() {
  const { code } = useParams();
  return <Navigate to={`/register?ref=${encodeURIComponent(code ?? '')}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        {/* Route-change loading bar. Outside Routes on purpose: the reference
            shows it on every internal navigation, auth screens included. */}
        <RouteProgress />
        <Routes>
          {/* Outside `Layout` on purpose: the reference drops the whole app
              shell on these two and splits the viewport instead.

              Both are wrapped: there is nothing to sign into when already
              signed in, and landing on a login form with a live session reads
              as the session having been lost. */}
          <Route
            path="login"
            element={
              <RedirectIfAuthenticated>
                <Login />
              </RedirectIfAuthenticated>
            }
          />
          <Route
            path="register"
            element={
              <RedirectIfAuthenticated>
                <SignUp />
              </RedirectIfAuthenticated>
            }
          />
          {/* Destinations the auth panels link out to. None of these screens is
              built yet, so they stub back rather than 404. */}
          {/* What the refer page's invite link points at. The reference's
              own link is `/ref/<code>`, and this keeps that shape while
              landing on the form that can use it: `SignUp` already reads
              `?ref=` and resolves it against
              `GET /profile/verify-referral/:code`. Outside `Layout` and
              outside the auth guards, because the whole point of the link is
              that a stranger opens it. */}
          <Route path="ref/:code" element={<ReferralLanding />} />
          {/* Password recovery. It WAS `<Navigate to="/login" />` — the link
              in the login panel's own footer sent a locked-out player back to
              the panel they had just failed at, which is to say the site had
              no account recovery at all.

              Behind `RedirectIfAuthenticated` like the other two auth
              screens: somebody already signed in who wants a new password
              wants `/profile/security`, which asks for the current one and
              needs no email round trip. */}
          <Route
            path="forgot-password"
            element={
              <RedirectIfAuthenticated>
                <ForgotPassword />
              </RedirectIfAuthenticated>
            }
          />
          <Route path="terms" element={<Navigate to="/register" replace />} />
          <Route path="privacy" element={<Navigate to="/register" replace />} />

          <Route element={<Layout />}>
            <Route index element={<Home />} />
            {/* `mode` is explicit because `live-casino` and `crash` are BOTH a
                category and one of the platform's five curated collections,
                and they list different games — the collection is a row an
                operator picked, the category is every game of that type.
                Inferring from the slug would make one of these two routes
                permanently unreachable. */}
            <Route path="categories/:slug" element={<Category mode="category" />} />
            {/* Before the collection route in source order for readability
                only — React Router ranks a static segment above a dynamic one
                regardless, so `/games/recent` can never fall through to
                `games/:slug` and render an empty collection.

                Guarded: the list is the player's own history, behind
                `authenticate()` on the platform, so asking as a visitor is a
                guaranteed 401. `RequireAuth` sends them to log in and brings
                them back here. */}
            <Route
              path="games/recent"
              element={
                <RequireAuth>
                  <Recent />
                </RequireAuth>
              }
            />
            <Route path="games/:slug" element={<Category mode="collection" />} />
            {/* The reference's third list space. A theme is a hand-picked set
                that cuts across type and studio, which is neither a category
                nor one of the platform's curated rows — `Theme.jsx` says why
                it is its own page rather than a third `mode` on `Category`. */}
            <Route path="themes/:slug" element={<Theme />} />
            <Route path="providers" element={<Providers />} />
            {/* The studio index and one studio's catalogue are different pages
                on the reference — the detail view is a filterable game list. */}
            <Route path="providers/:slug" element={<Provider />} />
            <Route path="play/:category/:slug" element={<Play />} />

            {/* The Loyalty Club sheet, reached from the account menu's
                `Loyalty` row and the account tab bar's `Loyalty` tab. It is
                NOT under `/profile`: the reference redirects
                `/profile/loyalty` here and drops the tab bar, so the redirect
                below keeps that URL working. Unguarded, because the page is
                marketing — it reads `LOYALTY` only to mark the tier the
                account is on, and the reference serves it signed out too. */}
            <Route path="loyalty" element={<Loyalty />} />
            <Route path="profile/loyalty" element={<Navigate to="/loyalty" replace />} />

            {/* The account area. `ProfileLayout` is the tab bar the reference
                puts over every one of these; Notifications, Rewards and
                Account are the three with a page behind them so far, and
                `/profile` on its own goes to Notifications rather than
                rendering a bar over nothing. Guarded, because a signed-out
                visitor has none of the three — `RequireAuth` sends them to log
                in and brings them back here afterwards. */}
            <Route
              path="profile"
              element={
                <RequireAuth>
                  <ProfileLayout />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/profile/notifications" replace />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="rewards" element={<Rewards />} />
              <Route path="account" element={<Account />} />
              <Route path="boosts" element={<Boosts />} />
              <Route path="security" element={<Security />} />
              <Route path="refer-a-friend" element={<Refer />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="settings" element={<Settings />} />
            </Route>

            {/* The list of campaigns, and the reference's own second tab
                beside it. `participations` is declared before the `:slug`
                redirect below, which would otherwise swallow it. */}
            <Route path="promotions" element={<Promotions />} />
            <Route path="promotions/participations" element={<Participations />} />
            {/* The campaigns with a page of their own, at the reference's own
                slugs — `data/promotionPages.js` is the list, and every entry
                there needs a route here or it falls through to the redirect
                below. The first two are home banner cards (League is also the
                sidebar's promo card); the third is the spin wheel over
                `/spin-wheel/*`, which used to be a panel on the index. */}
            <Route path="promotions/league-of-bitcasino" element={<League />} />
            <Route path="promotions/weekly-rakeback-2026" element={<WeeklyRakeback />} />
            <Route path="promotions/spin-the-wheel" element={<SpinWheel />} />
            {/* The slugs those links carried before the pages existed, and the
                year-less form of the rakeback one. Kept so anything already
                pointing at them — a bookmark, an old build — lands on the page
                rather than on the index. */}
            <Route
              path="promotions/league"
              element={<Navigate to="/promotions/league-of-bitcasino" replace />}
            />
            <Route
              path="promotions/weekly-rakeback"
              element={<Navigate to="/promotions/weekly-rakeback-2026" replace />}
            />
            {/**
              * Every other `promotions/:slug` still redirects to the index.
              *
              * There is nothing behind those slugs: `bonus_events` has a name
              * and a window, no slug and no body, so a per-promotion page
              * would have to invent everything on it — which is exactly what
              * `data/league.js` does for the one campaign above, deliberately
              * and with the reason written down. Sending the visitor to the
              * list they came for beats a 404 or a fabricated page, and it is
              * one route to delete when the platform grows a detail read.
              */}
            <Route path="promotions/:slug" element={<Navigate to="/promotions" replace />} />

            {/* The blog, over `GET /api/v1/admin/blogs` — public audience. */}
            <Route path="blog" element={<Blog />} />
            <Route path="blog/:slug" element={<BlogPost />} />
            <Route path="help-center/terms-and-conditions" element={<TermsAndConditions />} />
            <Route path="help-center/responsible-gaming" element={<ResponsibleGaming />} />
            <Route path="help-center/self-exclusion" element={<SelfExclusion />} />
            <Route path="help-center/dispute-resolution" element={<DisputeResolution />} />
            <Route path="help-center/aml" element={<AmlPolicy />} />
            <Route path="help-center/provably-fair" element={<ProvablyFair />} />
            <Route path="help-center/reward-terms" element={<RewardTerms />} />
            <Route path="help-center/privacy-policy" element={<PrivacyPolicy />} />
            {/* One data-driven category and article view covers every help topic.
                Add entries in data/helpArticles.js; no new page or route needed. */}
            <Route path="help-center/:categorySlug/:articleSlug" element={<HelpArticle />} />
            <Route path="help-center/:categorySlug" element={<HelpCategory />} />
            <Route path="help-center" element={<HelpCenter />} />
            <Route path="help-center/our-license" element={<OurLicense />} />
            <Route path="bitcoin-breakdown" element={<BitcoinBreakdown />} />
            {/* Tournaments is a real page now. `all/:filter` is the reference's
                own shape for the two `See all` links — `current` and `past` —
                and it is declared BEFORE nothing else can claim it, since
                there is no `/tournaments/:slug` route to shadow it: the
                reference's detail page is not built, so the cards' arrows do
                not link anywhere (see `TournamentCard`). */}
            <Route path="tournaments" element={<Tournaments />} />
            <Route path="tournaments/all/:filter" element={<TournamentList />} />
            {/* Real as of Phase 7 — `GET /user/bonus` carries the VIP level,
                the wager progress and the three periodic bonuses. */}
            <Route path="vip" element={<Vip />} />
            {/**
              * `testimonials` stays a redirect, and that is the intentional
              * one `docs/10`'s "Done when" allows for.
              *
              * On the reference it is a SECTION of the home page, not a page —
              * `Testimonials` is already rendered there. A route for it would
              * be a second copy of a block that is on the page it redirects
              * to.
              */}
            <Route path="testimonials" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
