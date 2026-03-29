import { create } from 'zustand'
import axios from 'axios'
import type { Vehicle, Notification, ChatMessage, FleetStats, Renter } from '../types'

axios.defaults.baseURL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

interface FleetStore {
  // Theme
  darkMode: boolean
  toggleDarkMode: () => void

  // Fleet
  vehicles: Vehicle[]
  selectedVehicle: Vehicle | null
  fleetLoading: boolean
  fleetError: string | null
  fetchVehicles: () => Promise<void>
  selectVehicle: (vehicle: Vehicle | null) => void
  updateVehicle: (plate: string, data: Partial<Vehicle>) => Promise<void>

  // Notifications
  notifications: Notification[]
  notifLoading: boolean
  fetchNotifications: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>

  // Chat
  messages: ChatMessage[]
  chatLoading: boolean
  sendMessage: (content: string) => Promise<void>
  clearChat: () => void

  // Stats
  stats: FleetStats | null
  computeStats: () => void

  // Renters
  renters: Renter[]
  rentersLoading: boolean
  fetchRenters: () => Promise<void>
  getRenter: (phone: string) => Promise<Renter | null>
  updateRenter: (phone: string, data: Partial<Renter>) => Promise<void>
  activateDebit: (phone: string, weeklyAmount: number) => Promise<void>
  pauseDebit: (phone: string) => Promise<void>
  resumeDebit: (phone: string) => Promise<void>

}

export const useStore = create<FleetStore>((set, get) => ({
  // ── Theme ──
  darkMode: localStorage.getItem('theme') === 'dark',
  toggleDarkMode: () => {
    const next = !get().darkMode
    localStorage.setItem('theme', next ? 'dark' : 'light')
    document.documentElement.classList.toggle('dark', next)
    set({ darkMode: next })
  },

  // ── Fleet ──
  vehicles: [],
  selectedVehicle: null,
  fleetLoading: false,
  fleetError: null,

  fetchVehicles: async () => {
    set({ fleetLoading: true, fleetError: null })
    try {
      const { data } = await axios.get<Vehicle[]>('/api/fleet')
      set({ vehicles: data, fleetLoading: false })
      get().computeStats()
    } catch (err) {
      set({ fleetError: 'Failed to load fleet data', fleetLoading: false })
    }
  },

  selectVehicle: (vehicle) => set({ selectedVehicle: vehicle }),

  updateVehicle: async (plate, data) => {
    try {
      const { data: updated } = await axios.put<Vehicle>(`/api/fleet/${plate}`, data)
      set((state) => ({
        vehicles: state.vehicles.map((v) => (v.plate === plate ? updated : v)),
        selectedVehicle: state.selectedVehicle?.plate === plate ? updated : state.selectedVehicle,
      }))
      get().computeStats()
    } catch (err) {
      console.error('Failed to update vehicle', err)
    }
  },

  // ── Notifications ──
  notifications: [],
  notifLoading: false,

  fetchNotifications: async () => {
    set({ notifLoading: true })
    try {
      const { data } = await axios.get<Notification[]>('/api/notifications')
      set({ notifications: data, notifLoading: false })
    } catch {
      set({ notifLoading: false })
    }
  },

  markRead: async (id) => {
    try {
      await axios.put(`/api/notifications/${id}`)
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n._id === id ? { ...n, read: true } : n
        ),
      }))
    } catch {
      console.error('Failed to mark notification as read')
    }
  },

  markAllRead: async () => {
    try {
      await axios.put('/api/notifications/read-all')
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, read: true })),
      }))
    } catch {
      console.error('Failed to mark all as read')
    }
  },

  // ── Chat ──
  messages: [],
  chatLoading: false,

  sendMessage: async (content) => {
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    }
    set((state) => ({ messages: [...state.messages, userMsg], chatLoading: true }))
    try {
      const { data } = await axios.post<{ reply: string }>('/api/chat', { message: content })
      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply,
        timestamp: new Date().toISOString(),
      }
      set((state) => ({ messages: [...state.messages, aiMsg], chatLoading: false }))
    } catch {
      const errMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I could not process your request right now.',
        timestamp: new Date().toISOString(),
      }
      set((state) => ({ messages: [...state.messages, errMsg], chatLoading: false }))
    }
  },

  clearChat: () => set({ messages: [] }),

  // ── Stats ──
  stats: null,
  computeStats: () => {
    const { vehicles, notifications } = get()
    const stats: FleetStats = {
      total: vehicles.length,
      available: vehicles.filter((v) => v.status === 'available').length,
      rented: vehicles.filter((v) => v.status === 'rented').length,
      service: vehicles.filter((v) => v.status === 'service').length,
      scooters: vehicles.filter((v) => v.type === 'scooter').length,
      cars: vehicles.filter((v) => v.type === 'car').length,
      unreadNotifications: notifications.filter((n) => !n.read).length,
      unpaidFines: vehicles.reduce(
        (acc, v) => acc + v.fines.filter((f) => !f.paid).length,
        0
      ),
    }
    set({ stats })
  },
  // ── Renters ──
  renters: [],
  rentersLoading: false,

  fetchRenters: async () => {
    set({ rentersLoading: true })
    try {
      const { data } = await axios.get<Renter[]>('/api/renters')
      set({ renters: data, rentersLoading: false })
    } catch {
      set({ rentersLoading: false })
    }
  },

  getRenter: async (phone) => {
    try {
      const { data } = await axios.get<Renter>(`/api/renters/${encodeURIComponent(phone)}`)
      return data
    } catch {
      return null
    }
  },

  updateRenter: async (phone, data) => {
    try {
      await axios.put(`/api/renters/${encodeURIComponent(phone)}`, data)
      get().fetchRenters()
    } catch (err) {
      console.error('Failed to update renter', err)
    }
  },

  activateDebit: async (phone, weeklyAmount) => {
    try {
      await axios.post(`/api/renters/${encodeURIComponent(phone)}/activate`, { weeklyAmount })
      get().fetchRenters()
    } catch (err) {
      console.error('Failed to activate debit', err)
    }
  },

  pauseDebit: async (phone) => {
    try {
      await axios.post(`/api/renters/${encodeURIComponent(phone)}/pause`)
      get().fetchRenters()
    } catch (err) {
      console.error('Failed to pause debit', err)
    }
  },

  resumeDebit: async (phone) => {
    try {
      await axios.post(`/api/renters/${encodeURIComponent(phone)}/resume`)
      get().fetchRenters()
    } catch (err) {
      console.error('Failed to resume debit', err)
    }
  },
}))

// Apply saved theme on load
if (localStorage.getItem('theme') === 'dark') {
  document.documentElement.classList.add('dark')
}
