export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

/** Express 5 forwards rejected async handlers here automatically. */
export function errorHandler(err, _req, res, _next) {
  const status = err instanceof HttpError ? err.status : 500;
  const message =
    err instanceof HttpError
      ? err.message
      : 'Internal server error';

  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
}
