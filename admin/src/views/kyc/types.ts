export type KycStatus = 'Unverified' | 'Pending' | 'Verified' | 'Rejected'

export type KycApplication = {
  id: number
  userId: string
  firstName: string
  lastName: string
  gender: string | null
  dateOfBirth: string | null
  address: string | null
  city: string | null
  country: string | null
  documentType: 'id_card' | 'passport' | 'driving_licence' | string
  status: KycStatus
  rejectionReason: string | null
  submittedAt: string | null
  reviewedAt: string | null
  documents: { idFront: boolean; idBack: boolean; passport: boolean }
}

export const KYC_STATUSES: KycStatus[] = ['Pending', 'Verified', 'Rejected', 'Unverified']

export const DOCUMENT_FIELDS = [
  { field: 'idFront', label: 'ID front' },
  { field: 'idBack', label: 'ID back' },
  { field: 'passport', label: 'Passport' }
] as const
