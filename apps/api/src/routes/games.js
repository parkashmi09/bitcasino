import { Router } from 'express';
import { z } from 'zod';
import { GAMES } from '../data/seed.js';
import { HttpError } from '../middleware/errors.js';

export const gamesRouter = Router();

const listQuery = z.object({
  category: z.string().optional(),
  provider: z.string().optional(),
  q: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

gamesRouter.get('/', (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid query parameters');
  }
  const { category, provider, q, limit, offset } = parsed.data;

  let results = GAMES;
  if (category) results = results.filter((g) => g.category === category);
  if (provider) results = results.filter((g) => g.provider === provider);
  if (q) {
    const needle = q.toLowerCase();
    results = results.filter(
      (g) =>
        g.title.toLowerCase().includes(needle) ||
        g.provider.toLowerCase().includes(needle),
    );
  }

  res.json({
    total: results.length,
    limit,
    offset,
    items: results.slice(offset, offset + limit),
  });
});

gamesRouter.get('/:slug', (req, res) => {
  const game = GAMES.find((g) => g.slug === req.params.slug);
  if (!game) throw new HttpError(404, 'Game not found');
  res.json(game);
});
