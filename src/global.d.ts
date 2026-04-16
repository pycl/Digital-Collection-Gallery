import type { GalleryState } from './types'

declare global {
  interface Window {
    galleryApp: {
      getVersion: () => Promise<string>
      openExternal: (url: string) => Promise<void>
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
        bannerIntervalSeconds?: number
        bannerVideoMuted?: boolean
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
