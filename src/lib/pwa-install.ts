interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let pendingPrompt: InstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  pendingPrompt = event as InstallPromptEvent
  notify()
})

window.addEventListener('appinstalled', () => {
  installed = true
  pendingPrompt = null
  notify()
})

export function isInstalled(): boolean {
  return (
    installed ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function canPromptInstall(): boolean {
  return Boolean(pendingPrompt) && !isInstalled()
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function promptInstall(): Promise<void> {
  const prompt = pendingPrompt
  if (!prompt) return
  pendingPrompt = null
  notify()
  try {
    await prompt.prompt()
    await prompt.userChoice
  } catch {
    // Browsers may reject a prompt after it expires. The manual route remains visible.
  }
}
