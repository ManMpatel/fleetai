/** The renter's link for a template. It is the same for every renter the template is sent to. */
export function formLink(code: string): string {
  return `${window.location.origin}/form/${code}`
}

/** 0412345678 -> 61412345678, the way WhatsApp wants a number. */
export function whatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) return `61${digits.slice(1)}`
  return digits
}

export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(text)}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* fall back below */ }
  try {
    const box = document.createElement('textarea')
    box.value = text
    box.setAttribute('readonly', '')
    box.style.position = 'fixed'
    box.style.opacity = '0'
    document.body.appendChild(box)
    box.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(box)
    return ok
  } catch {
    return false
  }
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
