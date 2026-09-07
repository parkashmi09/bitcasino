import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Home } from '@/pages/Home';
import { Category } from '@/pages/Category';
import { Providers } from '@/pages/Providers';
import { Provider } from '@/pages/Provider';
import { Play } from '@/pages/Play';
import { Login } from '@/pages/Login';
import { SignUp } from '@/pages/SignUp';
import { NotFound } from '@/pages/NotFound';
import { ScrollToTop } from '@/components/layout/ScrollToTop';
import { RouteProgress } from '@/components/layout/RouteProgress';

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      {/* Route-change loading bar. Outside Routes on purpose: the reference
          shows it on every internal navigation, auth screens included. */}
      <RouteProgress />
      <Routes>
        {/* Outside `Layout` on purpose: the reference drops the whole app
            shell on these two and splits the viewport instead. */}
        <Route path="login" element={<Login />} />
        <Route path="register" element={<SignUp />} />
        {/* Destinations the auth panels link out to. None of these screens is
            built yet, so they stub back rather than 404. */}
        <Route path="forgot-password" element={<Navigate to="/login" replace />} />
        <Route path="terms" element={<Navigate to="/register" replace />} />
        <Route path="privacy" element={<Navigate to="/register" replace />} />

        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="categories/:slug" element={<Category />} />
          <Route path="games/:slug" element={<Category />} />
          <Route path="providers" element={<Providers />} />
          {/* The studio index and one studio's catalogue are different pages
              on the reference — the detail view is a filterable game list. */}
          <Route path="providers/:slug" element={<Provider />} />
          <Route path="play/:category/:slug" element={<Play />} />
          {/* Marketing routes are stubbed against the category view for now. */}
          <Route path="promotions" element={<Navigate to="/" replace />} />
          <Route path="tournaments" element={<Navigate to="/" replace />} />
          <Route path="vip" element={<Navigate to="/" replace />} />
          <Route path="testimonials" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
