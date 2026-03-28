export type VehicleType = 'scooter' | 'car'
export type VehicleStatus = 'available' | 'rented' | 'service'
export type FineType = 'fine' | 'toll'
export type NotificationType = 'fine' | 'toll' | 'rego' | 'whatsapp' | 'info'

export interface Renter {
  _id: string
  name: string
  phone: string
  email: string
  licenceNumber: string
  currentVehicle?: string | Vehicle
  rentalHistory: RentalRecord[]
  createdAt: string
  updatedAt: string
}

export interface RentalRecord {
  vehicle: string | Vehicle
  startDate: string
  endDate?: string
}

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
