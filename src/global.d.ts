import type { GalleryState } from './types'

declare global {
  interface Window {
    galleryApp: {
      getVersion: () => Promise<string>
      openExternal: (url: string) => Promise<void>
      minimizeWindow: () => Promise<void>
      toggleMaximizeWindow: () => Promise<void>
      closeWindow: () => Promise<void>
      getWindowBounds: () => Promise<{
        x: number
        y: number
        width: number
        height: number
        isMaximized: boolean
      } | null>
      startWindowDrag: () => Promise<boolean>
      stopWindowDrag: () => void
      setWindowPosition: (x: number, y: number) => void
      getState: () => Promise<GalleryState>
      scanCollections: () => Promise<GalleryState>
      addImportPath: () => Promise<GalleryState>
      removeImportPath: (importPath: string) => Promise<GalleryState>
      updateConfig: (updates: {
        featuredEntries?: Array<{
          id: string
          collectionId: string
          assetPath: string | null
          title: string
          subtitle: string
          enabled: boolean
        }>
        language?: 'en' | 'zh'
        uiScale?: number
        bannerIntervalSeconds?: number
        bannerVideoMuted?: boolean
        fullscreenSlideshowEnabled?: boolean
        fullscreenSlideshowIntervalSeconds?: number
        fullscreenVideoAdvanceOnEnded?: boolean
        fullscreenVideoWaitingBehavior?: 'none' | 'complete' | 'replay' | 'pause'
        fullscreenSlideshowShuffleAllCollections?: boolean
      }) => Promise<GalleryState>
      updateCollection: (
        collectionId: string,
        updates: {
          displayName?: string
          manualCoverAsset?: string | null
          featuredAsset?: string | null
        },
      ) => Promise<GalleryState>
    }
  }
}

export {}
