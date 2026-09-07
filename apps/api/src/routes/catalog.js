import { Router } from 'express';
import { CATEGORIES, GAMES, PROVIDERS } from '../data/seed.js';
import { HttpError } from '../middleware/errors.js';

export const catalogRouter = Router();

catalogRouter.get('/categories', (_req, res) => {
  res.json(
    CATEGORIES.map((category) => ({
      ...category,
      gameCount: GAMES.filter((g) => g.category === category.slug).length,
    })),
  );
});

catalogRouter.get('/providers', (_req, res) => {
  res.json(PROVIDERS);
});

catalogRouter.get('/providers/:slug', (req, res) => {
  const provider = PROVIDERS.find((p) => p.slug === req.params.slug);
  if (!provider) throw new HttpError(404, 'Provider not found');

  res.json({
    ...provider,
    games: GAMES.filter((g) => g.provider === provider.name),
  });
});

/** Rails the home page renders, so ordering is controlled server-side. */
catalogRouter.get('/home', (_req, res) => {
  const rail = (slug) => GAMES.filter((g) => g.category === slug);

  res.json({
    rails: [
      { title: 'Originals', href: '/categories/originals', games: rail('originals') },
      { title: 'Best Live Casino games', href: '/categories/live-casino', games: rail('live-casino') },
      { title: 'Best Slot games', href: '/categories/video-slots', games: rail('video-slots') },
      { title: 'New Releases', href: '/games/new', games: GAMES.filter((g) => g.badge === 'new') },
      { title: 'Crash and Instant Win', href: '/categories/crash', games: rail('crash') },
      { title: 'Best table games', href: '/categories/table-games', games: rail('table-games') },
    ],
  });
});
