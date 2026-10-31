export type Pagination = {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

export type Envelope<T> =
  | { success: true; data: T; meta?: { pagination?: Pagination; [k: string]: unknown } }
  | { success: false; error: { code: string; message: string; details?: Record<string, unknown> } }

/** `meta`: the envelope's extra meta beside the pagination (e.g. a list's `summary`). */
export type Paged<T> = { rows: T[]; pagination: Pagination; meta?: Record<string, unknown> }

export type Query = Record<string, string | number | boolean | null | undefined>
