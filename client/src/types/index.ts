export type VehicleType = 'scooter' | 'car'
export type VehicleStatus = 'available' | 'rented' | 'service'
export type FineType = 'fine' | 'toll'
export type NotificationType = 'fine' | 'toll' | 'rego' | 'whatsapp' | 'info'

export interface Fine {
  _id: string
  vehicle: string | Vehicle
  renter?: string | Renter
  type: FineType
  amount: number
  description: string
  date: string
  paid: boolean
  pdfUrl?: string
  createdAt: string
  updatedAt: string
}

export interface Vehicle {
  _id: string
  plate: string
  model: string
  year: number
  type: VehicleType
  status: VehicleStatus
  currentRenter?: Renter | null
  rentStartDate?: string
  regoExpiry?: string
  pinkSlip?: string
  greenSlip?: string
  lastService?: string
  fines: Fine[]
  tolls: Fine[]
  notes?: string
  createdAt: string
  updatedAt: string
}

export interface PayWayInfo {
  customerId?: string
  status: 'active' | 'paused' | 'cancelled' | 'not_setup'
  weeklyAmount?: number
  startDate?: string
  nextDebitDate?: string
}

export interface RentalRecord {
  vehicle: string
  plate: string
  startDate: string
  endDate?: string
  weeklyRate?: number
  totalWeeks?: number
  totalAmount?: number
}

export interface Renter {
  _id: string
  name: string
  phone: string
  email: string
  dateOfBirth?: string
  licenceNumber?: string
  licencePhotoUrl?: string
  vehicleType?: 'scooter' | 'car'
  address?: {
    street?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
  }
  bankName?: string
  accountHolderName?: string
  bsbNumber?: string
  accountNumber?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  currentVehicle?: Vehicle | null
  rentStartDate?: string
  weeklyRate?: number
  payway?: PayWayInfo
  rentalHistory: RentalRecord[]
  createdAt: string
  updatedAt: string
}

export interface Notification {
  _id: string
  type: NotificationType
  title: string
  description: string
  plate?: string
  read: boolean
  date: string
  actionRequired: boolean
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface FleetStats {
  total: number
  available: number
  rented: number
  service: number
  scooters: number
  cars: number
  unreadNotifications: number
  unpaidFines: number
}