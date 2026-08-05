const MEDIA_PLAYBACK_CHANNEL = 'vfan-tv:media-playback'
const MEDIA_PLAYBACK_EVENT = 'vfan-tv:media-playback'

export type MediaPlaybackKind = 'radio' | 'video'

interface MediaPlaybackMessage {
  kind: MediaPlaybackKind
  ownerId: string
  type: 'playing'
}

export interface MediaPlaybackCoordinator {
  announcePlaying: () => void
  dispose: () => void
}

export function createMediaPlaybackCoordinator(
  kind: MediaPlaybackKind,
  onExternalPlayback: () => void,
): MediaPlaybackCoordinator {
  const ownerId = crypto.randomUUID()
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(MEDIA_PLAYBACK_CHANNEL)
  const handleMessage = (message: MediaPlaybackMessage): void => {
    if (message.type === 'playing' && message.ownerId !== ownerId) {
      onExternalPlayback()
    }
  }
  const handleWindowEvent = (event: Event): void => {
    const message = (event as CustomEvent<MediaPlaybackMessage>).detail
    if (message) handleMessage(message)
  }

  channel?.addEventListener('message', (event: MessageEvent<MediaPlaybackMessage>) => handleMessage(event.data))
  window.addEventListener(MEDIA_PLAYBACK_EVENT, handleWindowEvent)

  return {
    announcePlaying: () => {
      const message: MediaPlaybackMessage = { kind, ownerId, type: 'playing' }
      window.dispatchEvent(new CustomEvent(MEDIA_PLAYBACK_EVENT, { detail: message }))
      channel?.postMessage(message)
    },
    dispose: () => {
      channel?.close()
      window.removeEventListener(MEDIA_PLAYBACK_EVENT, handleWindowEvent)
    },
  }
}
