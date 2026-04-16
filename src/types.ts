export type GalleryAsset = {
  name: string
  path: string
  type: 'image' | 'video'
}

export type FeaturedEntry = {
  id: string
  collectionId: string
  assetPath: string | null
  title: string
  subtitle: string
  enabled: boolean
}

export type CollectionRecord = {
  id: string
  displayName: string
  folderPath: string
  assets: GalleryAsset[]
  imageCount: number
  videoCount: number
  assetCount: number
  manualCoverAsset: string | null
  coverAsset: string | null
  featuredAsset: string | null
  featuredAssetType: 'image' | 'video' | null
  updatedAt: string
}

export type AppConfig = {
  importPaths: string[]
  featuredEntries: FeaturedEntry[]
  bannerIntervalSeconds: number
  bannerVideoMuted: boolean
  collectionsSort: 'id_asc' | 'id_desc'
}

export type GalleryState = {
  config: AppConfig
  collections: CollectionRecord[]
}
