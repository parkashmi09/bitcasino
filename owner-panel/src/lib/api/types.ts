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

export type Paged<T> = { rows: T[]; pagination: Pagination }

export type Query = Record<string, string | number | boolean | null | undefined>
