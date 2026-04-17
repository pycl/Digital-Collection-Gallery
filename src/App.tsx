import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import './App.css'
import type { CollectionRecord, FeaturedEntry, GalleryAsset, GalleryState } from './types'

const emptyState: GalleryState = {
  config: {
    importPaths: [],
    featuredEntries: [],
    bannerIntervalSeconds: 8,
    bannerVideoMuted: true,
    fullscreenSlideshowEnabled: false,
    fullscreenSlideshowIntervalSeconds: 6,
    fullscreenVideoAdvanceOnEnded: true,
    fullscreenSlideshowShuffleAllCollections: false,
    collectionsSort: 'id_asc',
  },
  collections: [],
}

type GalleryContextValue = {
  galleryState: GalleryState
  loading: boolean
  busy: boolean
  error: string | null
  bridgeReady: boolean
  refreshCollections: () => Promise<void>
  importFolder: () => Promise<void>
  removeImportPath: (importPath: string) => Promise<void>
  updateConfig: (updates: {
    featuredEntries?: FeaturedEntry[]
    bannerIntervalSeconds?: number
    bannerVideoMuted?: boolean
    fullscreenSlideshowEnabled?: boolean
    fullscreenSlideshowIntervalSeconds?: number
    fullscreenVideoAdvanceOnEnded?: boolean
    fullscreenSlideshowShuffleAllCollections?: boolean
  }) => Promise<void>
  updateCollection: (
    collectionId: string,
    updates: {
      displayName?: string
      manualCoverAsset?: string | null
      featuredAsset?: string | null
    },
  ) => Promise<void>
}

const GalleryContext = createContext<GalleryContextValue | null>(null)

function toAssetUrl(assetPath: string) {
  return `gallery-file://${encodeURI(assetPath.replaceAll('\\', '/'))}`
}

function App() {
  return (
    <HashRouter>
      <GalleryProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/hall" element={<HallPage />} />
          <Route path="/hall-settings" element={<HallSettingsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/collections/:collectionId" element={<CollectionDetailPage />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </GalleryProvider>
    </HashRouter>
  )
}

function GalleryProvider({ children }: { children: ReactNode }) {
  const [galleryState, setGalleryState] = useState<GalleryState>(emptyState)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bridgeReady = typeof window.galleryApp !== 'undefined'

  async function runUpdate(loader: () => Promise<GalleryState>, pending = false) {
    try {
      setBusy(pending)
      setError(null)
      const nextState = await loader()
      setGalleryState(nextState)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown error'
      setError(message)
    } finally {
      setLoading(false)
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!bridgeReady) {
      setError('Electron preload bridge is unavailable. Restart the app after the latest code changes.')
      setLoading(false)
      return
    }

    void runUpdate(() => window.galleryApp.getState())
  }, [bridgeReady])

  const value: GalleryContextValue = {
    galleryState,
    loading,
    busy,
    error,
    bridgeReady,
    refreshCollections: () => runUpdate(() => window.galleryApp.scanCollections(), true),
    importFolder: () => runUpdate(() => window.galleryApp.addImportPath(), true),
    removeImportPath: (importPath) =>
      runUpdate(() => window.galleryApp.removeImportPath(importPath), true),
    updateConfig: (updates) => runUpdate(() => window.galleryApp.updateConfig(updates), true),
    updateCollection: (collectionId, updates) =>
      runUpdate(() => window.galleryApp.updateCollection(collectionId, updates), true),
  }

  return <GalleryContext.Provider value={value}>{children}</GalleryContext.Provider>
}

function useGallery() {
  const value = useContext(GalleryContext)
  if (!value) {
    throw new Error('Gallery context is unavailable.')
  }
  return value
}

function usePageScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) {
      return
    }

    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow
    const previousBodyTouchAction = body.style.touchAction
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    body.style.touchAction = 'none'
    body.style.overscrollBehavior = 'none'

    return () => {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
      body.style.touchAction = previousBodyTouchAction
      body.style.overscrollBehavior = previousBodyOverscrollBehavior
    }
  }, [locked])
}

function usePortraitHallLayout() {
  const [portraitLayout, setPortraitLayout] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.innerWidth <= 980 && window.innerHeight > window.innerWidth
  })

  useEffect(() => {
    function updateLayout() {
      setPortraitLayout(window.innerWidth <= 980 && window.innerHeight > window.innerWidth)
    }

    updateLayout()
    window.addEventListener('resize', updateLayout)
    return () => window.removeEventListener('resize', updateLayout)
  }, [])

  return portraitLayout
}

type ResolvedFeaturedEntry = {
  entry: FeaturedEntry
  collection: CollectionRecord
  asset: GalleryAsset | null
}

function createFeaturedEntry(collectionId: string, index: number): FeaturedEntry {
  return {
    id: `featured-${collectionId}-${index + 1}`,
    collectionId,
    assetPath: null,
    title: '',
    subtitle: '',
    enabled: true,
  }
}

function getCollectionFeaturedAsset(collection: CollectionRecord, assetPath?: string | null) {
  const resolvedPath = assetPath ?? collection.featuredAsset ?? collection.coverAsset
  return resolvedPath ? collection.assets.find((asset) => asset.path === resolvedPath) ?? null : null
}

function getResolvedFeaturedEntries(galleryState: GalleryState) {
  const configuredEntries =
    galleryState.config.featuredEntries.length > 0
      ? galleryState.config.featuredEntries
      : galleryState.collections.slice(0, 6).map((collection, index) => createFeaturedEntry(collection.id, index))

  return configuredEntries
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const collection = galleryState.collections.find((candidate) => candidate.id === entry.collectionId) ?? null
      if (!collection) {
        return null
      }

      return {
        entry,
        collection,
        asset: getCollectionFeaturedAsset(collection, entry.assetPath),
      }
    })
    .filter((entry): entry is ResolvedFeaturedEntry => entry !== null)
}

function getCircularOffset(index: number, activeIndex: number, length: number) {
  if (length <= 1) {
    return 0
  }

  const directOffset = index - activeIndex
  const wrapPositive = directOffset + length
  const wrapNegative = directOffset - length

  return [directOffset, wrapPositive, wrapNegative].reduce((bestOffset, candidateOffset) =>
    Math.abs(candidateOffset) < Math.abs(bestOffset) ? candidateOffset : bestOffset,
  )
}

function getAssetDisplayName(assetName: string) {
  const withoutExtension = assetName.replace(/\.[^.]+$/, '')
  return withoutExtension.replace(/^\d+[\s._-]*/, '')
}

function FeaturedBannerMedia({
  asset,
  assets,
  muted,
  paused,
  onVideoEnded,
}: {
  asset: GalleryAsset
  assets: GalleryAsset[]
  muted: boolean
  paused: boolean
  onVideoEnded: () => void
}) {
  const assetUrl = toAssetUrl(asset.path)
  const previewImageUrl = getPreviewImageUrl(asset, assets)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [videoReady, setVideoReady] = useState(asset.type === 'image')

  useEffect(() => {
    if (asset.type !== 'video' || !videoRef.current) {
      return
    }

    const videoElement = videoRef.current
    videoElement.load()

    const playPromise = videoElement.play()
    if (playPromise) {
      void playPromise.catch(() => {
        setVideoReady(false)
      })
    }
  }, [asset.path, asset.type, muted])

  useEffect(() => {
    if (asset.type !== 'video' || !videoRef.current) {
      return
    }

    const videoElement = videoRef.current

    if (paused) {
      videoElement.pause()
      return
    }

    const playPromise = videoElement.play()
    if (playPromise) {
      void playPromise.catch(() => {
        setVideoReady(false)
      })
    }
  }, [asset.path, asset.type, muted, paused])

  if (asset.type === 'image') {
    return <img alt={asset.name} src={assetUrl} />
  }

  return (
    <>
      {previewImageUrl ? (
        <img
          alt={asset.name}
          className={`featuredPoster ${videoReady ? 'featuredPosterHidden' : ''}`}
          src={previewImageUrl}
        />
      ) : null}
      <video
        autoPlay
        className={`featuredBannerVideo ${videoReady ? 'featuredBannerVideoReady' : ''}`}
        controls={false}
        muted={muted}
        onCanPlay={() => setVideoReady(true)}
        onEnded={onVideoEnded}
        onError={() => setVideoReady(false)}
        onLoadedData={() => setVideoReady(true)}
        onPlaying={() => setVideoReady(true)}
        playsInline
        poster={previewImageUrl ?? undefined}
        preload="metadata"
        ref={videoRef}
        src={assetUrl}
      />
    </>
  )
}

function HallMediaPreview({
  asset,
  assets,
  alt,
  active,
}: {
  asset: GalleryAsset | null
  assets: GalleryAsset[]
  alt: string
  active: boolean
}) {
  if (!asset) {
    return <div className="featuredPlaceholder">No art</div>
  }

  const assetUrl = toAssetUrl(asset.path)
  const previewImageUrl = getPreviewImageUrl(asset, assets)

  if (asset.type === 'video') {
    if (active || !previewImageUrl) {
      return <video autoPlay loop muted playsInline preload="metadata" src={assetUrl} />
    }

    return <img alt={alt} src={previewImageUrl} />
  }

  return <img alt={alt} src={assetUrl} />
}

function HomePage() {
  const { galleryState, loading, busy, error, bridgeReady, refreshCollections, importFolder, removeImportPath } =
    useGallery()
  const navigate = useNavigate()
  const featuredEntries = getResolvedFeaturedEntries(galleryState)
  const [activeFeaturedIndex, setActiveFeaturedIndex] = useState(0)
  const [featuredFullscreen, setFeaturedFullscreen] = useState(false)
  const [importRootsExpanded, setImportRootsExpanded] = useState(false)

  useEffect(() => {
    if (featuredEntries.length <= 1 || featuredFullscreen) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setActiveFeaturedIndex((currentIndex) => (currentIndex + 1) % featuredEntries.length)
    }, galleryState.config.bannerIntervalSeconds * 1000)

    return () => window.clearTimeout(timeoutId)
  }, [
    activeFeaturedIndex,
    featuredEntries.length,
    featuredFullscreen,
    galleryState.config.bannerIntervalSeconds,
  ])

  const resolvedFeaturedIndex =
    featuredEntries.length === 0 ? 0 : Math.min(activeFeaturedIndex, featuredEntries.length - 1)
  const featuredEntry = featuredEntries[resolvedFeaturedIndex] ?? null
  const featuredCollection = featuredEntry?.collection ?? null
  const featuredAsset = featuredEntry?.asset ?? null
  const featuredAssetUrl = featuredAsset ? toAssetUrl(featuredAsset.path) : null
  const featuredMediaType = featuredAsset?.type ?? null
  const featuredTitle =
    featuredEntry?.entry.title.trim() || featuredCollection?.displayName || 'No Collection Imported'
  const featuredSubtitle =
    featuredEntry?.entry.subtitle.trim() ||
    (featuredCollection ? `Collection ${featuredCollection.id}` : 'Create featured entries in Settings.')

  function showPreviousFeatured() {
    setActiveFeaturedIndex((currentIndex) =>
      featuredEntries.length === 0
        ? 0
        : (currentIndex - 1 + featuredEntries.length) % featuredEntries.length,
    )
  }

  function showNextFeatured() {
    setActiveFeaturedIndex((currentIndex) =>
      featuredEntries.length === 0 ? 0 : (currentIndex + 1) % featuredEntries.length,
    )
  }

  function handleFeaturedVideoEnded() {
    if (featuredFullscreen || featuredEntries.length <= 1 || featuredMediaType !== 'video') {
      return
    }

    showNextFeatured()
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>Digital Collection Gallery</h1>
          <p className="subtitle">
            Manage imported collections here, then open the dedicated hall page for immersive browsing.
          </p>
        </div>

        <div className="topbarActions">
          <button className="primaryButton" type="button" onClick={() => navigate('/hall')}>
            Open Hall
          </button>
          <button className="ghostButton" type="button" onClick={() => navigate('/settings')}>
            Settings
          </button>
          <button
            className="ghostButton"
            disabled={busy || !bridgeReady}
            type="button"
            onClick={() => void refreshCollections()}
          >
            Rescan
          </button>
          <button
            className="primaryButton"
            disabled={busy || !bridgeReady}
            type="button"
            onClick={() => void importFolder()}
          >
            Import Folder
          </button>
        </div>
      </header>

      {error ? <div className="statusBanner error">Error: {error}</div> : null}
      {busy ? <div className="statusBanner">Working...</div> : null}

      <main className="layout">
        <section className="heroPanel">
          <div className="heroCopy">
            <p className="sectionTag">Library Control</p>
            <h2>
              {featuredEntries.length > 0
                ? `${featuredEntries.length} featured card(s) are configured for the hall`
                : 'Import a collection root folder to populate the gallery'}
            </h2>
            <p>
              Imported numeric folders are already indexed into local collections. Use Settings to
              build a reusable featured card list, then open Hall to view the carousel layer on
              top of those entries.
            </p>

            <div className="importList">
              <div className="importListHeader">
                <strong>Imported roots</strong>
                <button
                  className="ghostButton importToggleButton"
                  type="button"
                  onClick={() => setImportRootsExpanded((current) => !current)}
                >
                  {importRootsExpanded ? 'Hide' : `Show (${galleryState.config.importPaths.length})`}
                </button>
              </div>
              {importRootsExpanded ? (
                galleryState.config.importPaths.length === 0 ? (
                  <p className="mutedText">No import folders yet.</p>
                ) : (
                  galleryState.config.importPaths.map((importPath) => (
                    <div className="importPathRow" key={importPath}>
                      <span>{importPath}</span>
                      <button
                        className="inlineButton"
                        disabled={busy || !bridgeReady}
                        type="button"
                        onClick={() => void removeImportPath(importPath)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )
              ) : (
                <p className="mutedText">Collapsed to keep the dashboard compact.</p>
              )}
            </div>
          </div>

          <article className="featuredCard">
            <div className="featuredArtworkShell">
              <button
                aria-label="Previous featured item"
                className="viewerNav featuredNavButton featuredNavButtonLeft"
                disabled={featuredEntries.length <= 1}
                type="button"
                onClick={showPreviousFeatured}
              />

              <button
                className="featuredArtworkButton"
                disabled={!featuredAssetUrl}
                type="button"
                onClick={() => setFeaturedFullscreen(true)}
              >
                <div className="featuredArtwork">
                  {featuredAssetUrl ? (
                    featuredAsset ? (
                      <FeaturedBannerMedia
                        asset={featuredAsset}
                        assets={featuredCollection?.assets ?? []}
                        key={featuredAsset.path}
                        muted={galleryState.config.bannerVideoMuted}
                        onVideoEnded={handleFeaturedVideoEnded}
                        paused={featuredFullscreen}
                      />
                    ) : (
                      <img alt={featuredCollection?.displayName} src={featuredAssetUrl} />
                    )
                  ) : (
                    <div className="featuredPlaceholder">No cover yet</div>
                  )}
                </div>
              </button>

              <button
                aria-label="Next featured item"
                className="viewerNav featuredNavButton featuredNavButtonRight"
                disabled={featuredEntries.length <= 1}
                type="button"
                onClick={showNextFeatured}
              />
            </div>
            <div className="featuredMeta">
              <span className="collectionId">
                {featuredCollection ? `CD.${featuredCollection.id}` : 'CD.00000000'}
              </span>
              <h3>{featuredTitle}</h3>
              <p className="metaLine">{featuredSubtitle}</p>
              {featuredEntries.length > 1 ? (
                <p className="featuredCounter">
                  {resolvedFeaturedIndex + 1} / {featuredEntries.length}
                </p>
              ) : (
                <p className="featuredCounter">
                  {featuredEntries.length === 0 ? 'No featured cards yet' : 'Single featured item'}
                </p>
              )}
              {featuredCollection ? (
                <div className="featuredActions">
                  <button
                    className="ghostButton"
                    disabled={!featuredAssetUrl}
                    type="button"
                    onClick={() => setFeaturedFullscreen(true)}
                  >
                    Expand Media
                  </button>
                  <button className="primaryButton" type="button" onClick={() => navigate('/hall')}>
                    Open Hall
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        </section>

        <section className="gridPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionTag">All Collections</p>
              <h2>
                {loading
                  ? 'Loading local collection index...'
                  : `${galleryState.collections.length} collection folder(s) indexed`}
              </h2>
            </div>
            <span className="pill">
              Sort: {galleryState.config.collectionsSort === 'id_desc' ? 'ID Desc' : 'ID Asc'}
            </span>
          </div>

          {galleryState.collections.length === 0 ? (
            <div className="emptyState">
              <strong>No collections found yet.</strong>
              <p>
                Use <code>Import Folder</code> and choose a directory whose child folders are named
                with numeric collection IDs such as <code>105435</code>.
              </p>
            </div>
          ) : (
            <div className="collectionGrid">
              {galleryState.collections.map((collection) => (
                <CollectionCard
                  collection={collection}
                  key={collection.id}
                  onOpen={() => navigate(`/collections/${collection.id}`)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {featuredFullscreen && featuredCollection && featuredAssetUrl ? (
        <FeaturedFullscreenOverlay
          collection={featuredCollection}
          mediaType={featuredMediaType}
          muted={galleryState.config.bannerVideoMuted}
          src={featuredAssetUrl}
          onClose={() => setFeaturedFullscreen(false)}
        />
      ) : null}
    </div>
  )
}

function HallPage() {
  const { galleryState, error } = useGallery()
  const navigate = useNavigate()
  const portraitHallLayout = usePortraitHallLayout()
  const featuredEntries = getResolvedFeaturedEntries(galleryState)
  const [activeIndex, setActiveIndex] = useState(0)
  const [hallFullscreen, setHallFullscreen] = useState(false)
  const hallViewportRef = useRef<HTMLDivElement | null>(null)
  const hallThumbRefs = useRef<Array<HTMLButtonElement | null>>([])
  const dragStartX = useRef<number | null>(null)
  const wheelLockRef = useRef(false)
  const [autoRotatePaused, setAutoRotatePaused] = useState(false)

  function showPrevious() {
    setActiveIndex((currentIndex) =>
      featuredEntries.length === 0
        ? 0
        : (currentIndex - 1 + featuredEntries.length) % featuredEntries.length,
    )
  }

  function showNext() {
    setActiveIndex((currentIndex) =>
      featuredEntries.length === 0 ? 0 : (currentIndex + 1) % featuredEntries.length,
    )
  }

  const resolvedActiveIndex =
    featuredEntries.length === 0 ? 0 : Math.min(activeIndex, featuredEntries.length - 1)
  const activeEntry = featuredEntries[resolvedActiveIndex] ?? null
  const activeTitle = activeEntry?.entry.title.trim() || activeEntry?.collection.displayName || 'No active entry'
  const activeSubtitle =
    activeEntry?.entry.subtitle.trim() || `Collection ${activeEntry?.collection.id ?? '000000'}`
  const activeAssetLabel = activeEntry?.asset ? getAssetDisplayName(activeEntry.asset.name) : ''
  const activePreviewImageUrl =
    activeEntry?.asset ? getPreviewImageUrl(activeEntry.asset, activeEntry.collection.assets) : null
  const activeBackdropUrl = activePreviewImageUrl || (activeEntry?.asset ? toAssetUrl(activeEntry.asset.path) : null)
  const activeBackdropVideo =
    activeEntry?.asset?.type === 'video' && !activePreviewImageUrl ? toAssetUrl(activeEntry.asset.path) : null
  const previousIndex =
    featuredEntries.length === 0
      ? null
      : (resolvedActiveIndex - 1 + featuredEntries.length) % featuredEntries.length
  const nextIndex =
    featuredEntries.length === 0 ? null : (resolvedActiveIndex + 1) % featuredEntries.length
  const previousEntry =
    previousIndex === null || featuredEntries.length <= 1 ? null : featuredEntries[previousIndex] ?? null
  const nextEntry =
    nextIndex === null || featuredEntries.length <= 1 ? null : featuredEntries[nextIndex] ?? null

  useEffect(() => {
    if (featuredEntries.length <= 1 || autoRotatePaused || hallFullscreen) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setActiveIndex((currentIndex) => (currentIndex + 1) % featuredEntries.length)
    }, galleryState.config.bannerIntervalSeconds * 1000)

    return () => window.clearTimeout(timeoutId)
  }, [
    activeIndex,
    autoRotatePaused,
    featuredEntries.length,
    galleryState.config.bannerIntervalSeconds,
    hallFullscreen,
  ])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setActiveIndex((currentIndex) =>
          featuredEntries.length === 0
            ? 0
            : (currentIndex - 1 + featuredEntries.length) % featuredEntries.length,
        )
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setActiveIndex((currentIndex) =>
          featuredEntries.length === 0 ? 0 : (currentIndex + 1) % featuredEntries.length,
        )
      } else if (event.key === 'Enter' && activeEntry) {
        setHallFullscreen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeEntry, featuredEntries.length])

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    dragStartX.current = event.clientX
    setAutoRotatePaused(true)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
    if (dragStartX.current === null) {
      return
    }

    const deltaX = event.clientX - dragStartX.current
    dragStartX.current = null

    if (Math.abs(deltaX) < 56) {
      return
    }

    if (deltaX > 0) {
      showPrevious()
      return
    }

    showNext()
  }

  useEffect(() => {
    const viewport = hallViewportRef.current
    if (!viewport) {
      return
    }

    function handleViewportWheel(event: WheelEvent) {
      if (featuredEntries.length <= 1 || wheelLockRef.current) {
        return
      }

      const axisDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (Math.abs(axisDelta) < 28) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      wheelLockRef.current = true
      window.setTimeout(() => {
        wheelLockRef.current = false
      }, 180)

      setAutoRotatePaused(true)
      if (axisDelta > 0) {
        setActiveIndex((currentIndex) =>
          featuredEntries.length === 0 ? 0 : (currentIndex + 1) % featuredEntries.length,
        )
        return
      }

      setActiveIndex((currentIndex) =>
        featuredEntries.length === 0
          ? 0
          : (currentIndex - 1 + featuredEntries.length) % featuredEntries.length,
      )
    }

    viewport.addEventListener('wheel', handleViewportWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleViewportWheel)
  }, [featuredEntries.length])

  useEffect(() => {
    const activeThumb = hallThumbRefs.current[resolvedActiveIndex]
    if (!activeThumb) {
      return
    }

    activeThumb.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [resolvedActiveIndex, featuredEntries.length])

  return (
    <div className="shell hallShell">
      {activeBackdropUrl ? (
        <div className="hallBackdrop" aria-hidden="true">
          {activeBackdropVideo ? (
            <video autoPlay loop muted playsInline preload="metadata" src={activeBackdropVideo} />
          ) : (
            <img alt="" src={activeBackdropUrl} />
          )}
        </div>
      ) : null}

      <header className="topbar">
        <div>
          <p className="eyebrow">Featured Hall</p>
          <h1>Curated Display</h1>
          <p className="subtitle">
            This page is now the dedicated exhibition layer. Drag, scroll, or use the arrow keys to
            rotate the featured card ring.
          </p>
        </div>

        <div className="topbarActions">
          <button className="ghostButton" type="button" onClick={() => navigate('/')}>
            Dashboard
          </button>
          <button className="ghostButton" type="button" onClick={() => navigate('/hall-settings')}>
            Edit Entries
          </button>
        </div>
      </header>

      {error ? <div className="statusBanner error">Error: {error}</div> : null}

      <main className="hallLayout">
        <section className="hallStagePanel">
          <div className="hallStageHeader">
            <p className="sectionTag">Featured Ring</p>
            <div className="hallStageMeta">
              <span className="pill">
                {featuredEntries.length > 0 ? `${resolvedActiveIndex + 1} / ${featuredEntries.length}` : '0 / 0'}
              </span>
            </div>
          </div>

          {featuredEntries.length === 0 ? (
            <div className="emptyState">
              <strong>No featured cards configured yet.</strong>
              <p>Open Hall Settings and add at least one featured entry to populate the hall.</p>
            </div>
          ) : (
            <div
              className="hallViewport"
              ref={hallViewportRef}
              onBlurCapture={() => setAutoRotatePaused(false)}
              onMouseEnter={() => setAutoRotatePaused(true)}
              onMouseLeave={() => setAutoRotatePaused(false)}
              onPointerCancel={() => {
                dragStartX.current = null
              }}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
            >
              <button
                aria-label="Previous featured card"
                className="viewerNav hallNavButton hallNavButtonLeft"
                disabled={featuredEntries.length <= 1}
                type="button"
                onClick={showPrevious}
              />

              {portraitHallLayout ? (
                <div className="hallFlatCarousel">
                  {previousEntry ? (
                    <button
                      className="hallFlatSideCard hallFlatSideCardLeft"
                      type="button"
                      onClick={() => setActiveIndex(previousIndex ?? 0)}
                    >
                      <div className="hallCardArtwork hallFlatArtwork">
                        <HallMediaPreview
                          active={false}
                          alt={previousEntry.entry.title || previousEntry.collection.displayName}
                          asset={previousEntry.asset}
                          assets={previousEntry.collection.assets}
                        />
                      </div>
                    </button>
                  ) : null}

                  {activeEntry ? (
                    <button
                      className="hallFlatHeroCard"
                      type="button"
                      onClick={() => {
                        if (activeEntry.asset) {
                          setHallFullscreen(true)
                        }
                      }}
                    >
                      <div className="hallHeroFrame hallFlatHeroFrame">
                        <div className="hallCardArtwork hallHeroArtwork hallFlatArtwork">
                          <HallMediaPreview
                            active
                            alt={activeTitle}
                            asset={activeEntry.asset}
                            assets={activeEntry.collection.assets}
                          />
                        </div>
                      </div>
                    </button>
                  ) : null}

                  {nextEntry ? (
                    <button
                      className="hallFlatSideCard hallFlatSideCardRight"
                      type="button"
                      onClick={() => setActiveIndex(nextIndex ?? 0)}
                    >
                      <div className="hallCardArtwork hallFlatArtwork">
                        <HallMediaPreview
                          active={false}
                          alt={nextEntry.entry.title || nextEntry.collection.displayName}
                          asset={nextEntry.asset}
                          assets={nextEntry.collection.assets}
                        />
                      </div>
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="hallStageOrbit">
                  <div className="hallOrbitTrack" aria-hidden="true" />

                  <div className="hallRing">
                    {featuredEntries.map((featured, index) => {
                      const offset = getCircularOffset(index, resolvedActiveIndex, featuredEntries.length)
                      const distance = Math.abs(offset)
                      const visible = distance > 0 && distance <= 3
                      if (!visible) {
                        return null
                      }

                      return (
                        <button
                          className="hallSideCard"
                          key={featured.entry.id}
                          style={
                            {
                              '--hall-offset': offset,
                              '--hall-depth': `${Math.max(-160, 120 - distance * 90)}px`,
                              '--hall-opacity': `${Math.max(0.14, 0.92 - distance * 0.22)}`,
                              '--hall-scale': `${Math.max(0.58, 0.88 - distance * 0.12)}`,
                              '--hall-blur': `${Math.max(0.8, distance * 2.4)}px`,
                              '--hall-y': `${Math.min(72, distance * 22)}px`,
                              '--hall-z': `${20 - distance}`,
                            } as CSSProperties
                          }
                          type="button"
                          onClick={() => setActiveIndex(index)}
                        >
                          <div className="hallCardArtwork">
                            <HallMediaPreview
                              active={false}
                              alt={featured.entry.title || featured.collection.displayName}
                              asset={featured.asset}
                              assets={featured.collection.assets}
                            />
                          </div>
                          <div className="hallCardMeta">
                            <span className="collectionId">CD.{featured.collection.id}</span>
                            {featured.asset ? <span>{getAssetDisplayName(featured.asset.name)}</span> : null}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  {activeEntry ? (
                    <button
                      className="hallHeroCard"
                      type="button"
                      onClick={() => {
                        if (activeEntry.asset) {
                          setHallFullscreen(true)
                        }
                      }}
                    >
                      <div className="hallHeroFrame">
                        <div className="hallCardArtwork hallHeroArtwork">
                          <HallMediaPreview
                            active
                            alt={activeTitle}
                            asset={activeEntry.asset}
                            assets={activeEntry.collection.assets}
                          />
                        </div>
                      </div>
                      <div className="hallHeroMeta">
                        <span className="collectionId">CD.{activeEntry.collection.id}</span>
                        {activeAssetLabel ? <span className="hallHeroAssetLabel">{activeAssetLabel}</span> : null}
                        <strong>{activeTitle}</strong>
                        <span>{activeSubtitle}</span>
                      </div>
                    </button>
                  ) : null}
                </div>
              )}

              <button
                aria-label="Next featured card"
                className="viewerNav hallNavButton hallNavButtonRight"
                disabled={featuredEntries.length <= 1}
                type="button"
                onClick={showNext}
              />
            </div>
          )}

          {activeEntry ? (
            <div className="hallPortraitMeta">
              <div className="hallPortraitTitleRow">
                <span className="hallPortraitTitleLine" aria-hidden="true" />
                <button
                  className="hallPortraitTitleButton"
                  type="button"
                  onClick={() => navigate(`/collections/${activeEntry.collection.id}`)}
                >
                  {activeTitle}
                </button>
                <span className="hallPortraitTitleLine" aria-hidden="true" />
              </div>
            </div>
          ) : null}

          {featuredEntries.length > 0 ? (
            <div className="hallEntryDock">
              <div className="hallEntryRail">
                {featuredEntries.map((featured, index) => {
                  const previewImageUrl = featured.asset
                    ? getPreviewImageUrl(featured.asset, featured.collection.assets)
                    : null
                  const fallbackAssetUrl = featured.asset ? toAssetUrl(featured.asset.path) : null
                  const thumbUrl = previewImageUrl ?? fallbackAssetUrl

                  return (
                    <button
                      aria-current={index === resolvedActiveIndex ? 'true' : undefined}
                      className={`hallEntryThumb ${index === resolvedActiveIndex ? 'hallEntryThumbActive' : ''}`}
                      key={`hall-thumb-${featured.entry.id}`}
                      ref={(node) => {
                        hallThumbRefs.current[index] = node
                      }}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                    >
                      <div className="hallEntryThumbMedia">
                        {thumbUrl ? (
                          <img alt={featured.entry.title || featured.collection.displayName} src={thumbUrl} />
                        ) : (
                          <div className="collectionPlaceholder">No preview</div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </section>

        <section className="gridPanel hallInfoPanel">
          {activeEntry ? (
            <div className="hallInfoBody">
              <p className="sectionTag">Current Card</p>
              <button
                className="hallTitleButton"
                type="button"
                onClick={() => navigate(`/collections/${activeEntry.collection.id}`)}
              >
                {activeTitle}
              </button>
              <div className="hallInfoMeta">
                <span>CD.{activeEntry.collection.id}</span>
                <span>{activeEntry.asset?.type === 'video' ? 'Video' : 'Image'}</span>
              </div>
              <p className="subtitle">{activeSubtitle}</p>
              <div className="hallInfoActions">
                <button
                  className="primaryButton"
                  disabled={!activeEntry.asset}
                  type="button"
                  onClick={() => setHallFullscreen(true)}
                >
                  Expand Media
                </button>
                <button className="ghostButton" type="button" onClick={() => navigate('/hall-settings')}>
                  Edit Entries
                </button>
              </div>
            </div>
          ) : (
            <div className="emptyState">
              <strong>No hall entries yet.</strong>
              <p>Go to Hall Settings and start composing featured cards.</p>
            </div>
          )}
        </section>
      </main>

      {hallFullscreen && activeEntry?.asset ? (
        <HallFullscreenOverlay
          config={galleryState.config}
          mediaType={activeEntry.asset?.type ?? null}
          muted={galleryState.config.bannerVideoMuted}
          onNext={showNext}
          src={toAssetUrl(activeEntry.asset.path)}
          title={activeTitle}
          onClose={() => setHallFullscreen(false)}
        />
      ) : null}
    </div>
  )
}

function SettingsPage() {
  const { galleryState, loading, busy, error, bridgeReady, updateConfig, updateCollection } = useGallery()
  const navigate = useNavigate()

  return (
    <div className="shell">
      <header className="detailTopbar">
        <div className="detailTitleBlock">
          <button className="ghostButton" type="button" onClick={() => navigate('/')}>
            Back
          </button>
          <div className="viewerInfoCard">
            <p className="eyebrow">Settings</p>
            <h1>Collection Settings</h1>
            <p className="subtitle">
              Edit display names, manual covers, and featured media for each imported collection.
            </p>
          </div>
        </div>
      </header>

      {error ? <div className="statusBanner error">Error: {error}</div> : null}

      <main className="detailLayout">
        <ViewerSettingsSection
          bridgeReady={bridgeReady}
          busy={busy}
          config={galleryState.config}
          onSave={updateConfig}
        />

        <section className="gridPanel settingsPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionTag">Hall Settings</p>
              <h2>Featured hall cards are managed separately now</h2>
            </div>
          </div>

          <article className="settingsTextPanel hallSettingsShortcutCard">
            <div className="settingsBody">
              <p className="subtitle">
                The featured hall card builder controls what appears in the exhibition view. Open the
                dedicated settings page to edit entries, media, rotation timing, and preview each card.
              </p>
              <div className="settingsActions">
                <button className="primaryButton" type="button" onClick={() => navigate('/hall-settings')}>
                  Open Hall Settings
                </button>
                <button className="ghostButton" type="button" onClick={() => navigate('/hall')}>
                  Preview Hall
                </button>
              </div>
            </div>
          </article>
        </section>

        <section className="gridPanel settingsPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionTag">Imported Collections</p>
              <h2>
                {loading
                  ? 'Loading settings...'
                  : `${galleryState.collections.length} collection setting row(s) available`}
              </h2>
            </div>
          </div>

          {galleryState.collections.length === 0 ? (
            <div className="emptyState">
              <strong>No collections imported yet.</strong>
              <p>Return to the home page and import at least one numeric collection folder first.</p>
            </div>
          ) : (
            <div className="settingsList">
              {galleryState.collections.map((collection) => (
                <CollectionSettingsRow
                  bridgeReady={bridgeReady}
                  busy={busy}
                  collection={collection}
                  key={collection.id}
                  onSave={(updates) => updateCollection(collection.id, updates)}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function ViewerSettingsSection({
  config,
  busy,
  bridgeReady,
  onSave,
}: {
  config: GalleryState['config']
  busy: boolean
  bridgeReady: boolean
  onSave: (updates: {
    fullscreenSlideshowEnabled?: boolean
    fullscreenSlideshowIntervalSeconds?: number
    fullscreenVideoAdvanceOnEnded?: boolean
    fullscreenSlideshowShuffleAllCollections?: boolean
  }) => Promise<void>
}) {
  const [fullscreenSlideshowEnabled, setFullscreenSlideshowEnabled] = useState(config.fullscreenSlideshowEnabled)
  const [fullscreenSlideshowIntervalSeconds, setFullscreenSlideshowIntervalSeconds] = useState(
    String(config.fullscreenSlideshowIntervalSeconds),
  )
  const [fullscreenVideoAdvanceOnEnded, setFullscreenVideoAdvanceOnEnded] = useState(
    config.fullscreenVideoAdvanceOnEnded,
  )
  const [fullscreenSlideshowShuffleAllCollections, setFullscreenSlideshowShuffleAllCollections] = useState(
    config.fullscreenSlideshowShuffleAllCollections,
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setFullscreenSlideshowEnabled(config.fullscreenSlideshowEnabled)
    setFullscreenSlideshowIntervalSeconds(String(config.fullscreenSlideshowIntervalSeconds))
    setFullscreenVideoAdvanceOnEnded(config.fullscreenVideoAdvanceOnEnded)
    setFullscreenSlideshowShuffleAllCollections(config.fullscreenSlideshowShuffleAllCollections)
  }, [
    config.fullscreenSlideshowEnabled,
    config.fullscreenSlideshowIntervalSeconds,
    config.fullscreenVideoAdvanceOnEnded,
    config.fullscreenSlideshowShuffleAllCollections,
  ])

  const normalizedInterval = Number(fullscreenSlideshowIntervalSeconds)
  const isDirty =
    fullscreenSlideshowEnabled !== config.fullscreenSlideshowEnabled ||
    normalizedInterval !== config.fullscreenSlideshowIntervalSeconds ||
    fullscreenVideoAdvanceOnEnded !== config.fullscreenVideoAdvanceOnEnded ||
    fullscreenSlideshowShuffleAllCollections !== config.fullscreenSlideshowShuffleAllCollections

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({
        fullscreenSlideshowEnabled,
        fullscreenSlideshowIntervalSeconds: Number.isFinite(normalizedInterval)
          ? normalizedInterval
          : config.fullscreenSlideshowIntervalSeconds,
        fullscreenVideoAdvanceOnEnded,
        fullscreenSlideshowShuffleAllCollections,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="gridPanel settingsPanel">
      <div className="panelHeader">
        <div>
          <p className="sectionTag">Viewer Settings</p>
          <h2>Fullscreen Viewer Behavior</h2>
        </div>
      </div>

      <article className="settingsTextPanel">
        <div className="settingsBody">
          <label className="settingsToggle">
            <input
              checked={fullscreenSlideshowEnabled}
              type="checkbox"
              onChange={(event) => setFullscreenSlideshowEnabled(event.target.checked)}
            />
            <span>Enable fullscreen slideshow</span>
          </label>

          <label className="settingsField">
            <span>Slideshow Interval Seconds</span>
            <input
              className="settingsInput"
              disabled={!fullscreenSlideshowEnabled}
              min="2"
              step="1"
              type="number"
              value={fullscreenSlideshowIntervalSeconds}
              onChange={(event) => setFullscreenSlideshowIntervalSeconds(event.target.value)}
            />
          </label>

          <label className="settingsToggle">
            <input
              checked={fullscreenVideoAdvanceOnEnded}
              disabled={!fullscreenSlideshowEnabled}
              type="checkbox"
              onChange={(event) => setFullscreenVideoAdvanceOnEnded(event.target.checked)}
            />
            <span>When fullscreen media is a video, continue on video end instead of waiting for the timer</span>
          </label>

          <label className="settingsToggle">
            <input
              checked={fullscreenSlideshowShuffleAllCollections}
              disabled={!fullscreenSlideshowEnabled}
              type="checkbox"
              onChange={(event) => setFullscreenSlideshowShuffleAllCollections(event.target.checked)}
            />
            <span>When slideshow is enabled, randomly continue with media from all imported collections</span>
          </label>

          <p className="settingsHint">
            This affects fullscreen collection viewing. Images advance by timer when slideshow is enabled. Videos can
            either wait for the same timer or move to the next asset as soon as playback finishes. Random mode only
            affects automatic progression, not your manual left/right navigation.
          </p>

          <div className="settingsActions">
            <button
              className="primaryButton"
              disabled={!bridgeReady || busy || saving || !isDirty}
              type="button"
              onClick={() => void handleSave()}
            >
              {saving ? 'Saving...' : 'Save Viewer Settings'}
            </button>
            <button
              className="ghostButton"
              disabled={saving || !isDirty}
              type="button"
              onClick={() => {
                setFullscreenSlideshowEnabled(config.fullscreenSlideshowEnabled)
                setFullscreenSlideshowIntervalSeconds(String(config.fullscreenSlideshowIntervalSeconds))
                setFullscreenVideoAdvanceOnEnded(config.fullscreenVideoAdvanceOnEnded)
                setFullscreenSlideshowShuffleAllCollections(config.fullscreenSlideshowShuffleAllCollections)
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </article>
    </section>
  )
}

function HallSettingsPage() {
  const { galleryState, busy, error, bridgeReady, updateConfig } = useGallery()
  const navigate = useNavigate()

  return (
    <div className="shell">
      <header className="detailTopbar">
        <div className="detailTitleBlock">
          <button className="ghostButton" type="button" onClick={() => navigate('/settings')}>
            Back
          </button>
          <div className="viewerInfoCard">
            <p className="eyebrow">Hall Settings</p>
            <h1>Featured Hall Builder</h1>
            <p className="subtitle">
              Configure the curated cards shown in the exhibition hall. Each entry can target any
              collection and any media item, with its own title, subtitle, and preview.
            </p>
          </div>
        </div>
      </header>

      {error ? <div className="statusBanner error">Error: {error}</div> : null}

      <main className="detailLayout">
        <BannerSettingsSection
          bridgeReady={bridgeReady}
          busy={busy}
          collections={galleryState.collections}
          config={galleryState.config}
          onSave={updateConfig}
        />
      </main>
    </div>
  )
}

function BannerSettingsSection({
  config,
  busy,
  bridgeReady,
  collections,
  onSave,
}: {
  config: GalleryState['config']
  busy: boolean
  bridgeReady: boolean
  collections: CollectionRecord[]
  onSave: (updates: {
    featuredEntries?: FeaturedEntry[]
    bannerIntervalSeconds?: number
    bannerVideoMuted?: boolean
  }) => Promise<void>
}) {
  const [featuredEntries, setFeaturedEntries] = useState(config.featuredEntries)
  const [bannerIntervalSeconds, setBannerIntervalSeconds] = useState(String(config.bannerIntervalSeconds))
  const [bannerVideoMuted, setBannerVideoMuted] = useState(config.bannerVideoMuted)
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null)
  const [dragOverEntryId, setDragOverEntryId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setFeaturedEntries(config.featuredEntries)
    setBannerIntervalSeconds(String(config.bannerIntervalSeconds))
    setBannerVideoMuted(config.bannerVideoMuted)
    setDraggedEntryId(null)
    setDragOverEntryId(null)
  }, [config.bannerIntervalSeconds, config.bannerVideoMuted, config.featuredEntries])

  const normalizedInterval = Number(bannerIntervalSeconds)
  const representedCollectionIds = new Set(featuredEntries.map((entry) => entry.collectionId))
  const missingCollections = collections.filter((collection) => !representedCollectionIds.has(collection.id))
  const isDirty =
    JSON.stringify(featuredEntries) !== JSON.stringify(config.featuredEntries) ||
    normalizedInterval !== config.bannerIntervalSeconds ||
    bannerVideoMuted !== config.bannerVideoMuted

  function updateEntry(entryId: string, updater: (entry: FeaturedEntry) => FeaturedEntry) {
    setFeaturedEntries((currentEntries) =>
      currentEntries.map((entry) => (entry.id === entryId ? updater(entry) : entry)),
    )
  }

  function addEntry() {
    const collection = collections[0]
    setFeaturedEntries((currentEntries) => [
      ...currentEntries,
      createFeaturedEntry(collection?.id ?? '000000', currentEntries.length),
    ])
  }

  function addMissingCollections() {
    if (missingCollections.length === 0) {
      return
    }

    setFeaturedEntries((currentEntries) => [
      ...currentEntries,
      ...missingCollections.map((collection, index) => createFeaturedEntry(collection.id, currentEntries.length + index)),
    ])
  }

  function removeEntry(entryId: string) {
    setFeaturedEntries((currentEntries) => currentEntries.filter((entry) => entry.id !== entryId))
  }

  function duplicateEntry(entryId: string) {
    setFeaturedEntries((currentEntries) => {
      const index = currentEntries.findIndex((entry) => entry.id === entryId)
      if (index === -1) {
        return currentEntries
      }

      const sourceEntry = currentEntries[index]
      const duplicatedEntry: FeaturedEntry = {
        ...sourceEntry,
        id: `${sourceEntry.collectionId}-${Date.now()}-${index}`,
      }

      return [
        ...currentEntries.slice(0, index + 1),
        duplicatedEntry,
        ...currentEntries.slice(index + 1),
      ]
    })
  }

  function moveEntry(entryId: string, direction: 'up' | 'down') {
    setFeaturedEntries((currentEntries) => {
      const index = currentEntries.findIndex((entry) => entry.id === entryId)
      if (index === -1) {
        return currentEntries
      }

      const nextIndex = direction === 'up' ? index - 1 : index + 1
      if (nextIndex < 0 || nextIndex >= currentEntries.length) {
        return currentEntries
      }

      const nextEntries = [...currentEntries]
      const [movedEntry] = nextEntries.splice(index, 1)
      nextEntries.splice(nextIndex, 0, movedEntry)
      return nextEntries
    })
  }

  function cycleEntryAsset(
    entryId: string,
    availableAssets: GalleryAsset[],
    resolvedPreviewAsset: GalleryAsset | null,
    direction: 'previous' | 'next',
  ) {
    if (availableAssets.length === 0) {
      return
    }

    setFeaturedEntries((currentEntries) =>
      currentEntries.map((entry) => {
        if (entry.id !== entryId) {
          return entry
        }

        const currentIndex =
          entry.assetPath !== null
            ? availableAssets.findIndex((asset) => asset.path === entry.assetPath)
            : resolvedPreviewAsset
              ? availableAssets.findIndex((asset) => asset.path === resolvedPreviewAsset.path)
              : -1

        const fallbackIndex = currentIndex === -1 ? 0 : currentIndex
        const nextIndex =
          direction === 'next'
            ? (fallbackIndex + 1) % availableAssets.length
            : (fallbackIndex - 1 + availableAssets.length) % availableAssets.length

        return {
          ...entry,
          assetPath: availableAssets[nextIndex]?.path ?? entry.assetPath,
        }
      }),
    )
  }

  function reorderEntries(sourceEntryId: string, targetEntryId: string) {
    if (sourceEntryId === targetEntryId) {
      return
    }

    setFeaturedEntries((currentEntries) => {
      const sourceIndex = currentEntries.findIndex((entry) => entry.id === sourceEntryId)
      const targetIndex = currentEntries.findIndex((entry) => entry.id === targetEntryId)
      if (sourceIndex === -1 || targetIndex === -1) {
        return currentEntries
      }

      const nextEntries = [...currentEntries]
      const [movedEntry] = nextEntries.splice(sourceIndex, 1)
      nextEntries.splice(targetIndex, 0, movedEntry)
      return nextEntries
    })
  }

  function handleEntryDragStart(event: ReactDragEvent<HTMLElement>, entryId: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', entryId)
    setDraggedEntryId(entryId)
    setDragOverEntryId(entryId)
  }

  function handleEntryDragOver(event: ReactDragEvent<HTMLElement>, entryId: string) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragOverEntryId !== entryId) {
      setDragOverEntryId(entryId)
    }
  }

  function handleEntryDrop(event: ReactDragEvent<HTMLElement>, targetEntryId: string) {
    event.preventDefault()
    const sourceEntryId = draggedEntryId ?? event.dataTransfer.getData('text/plain')
    if (!sourceEntryId) {
      return
    }

    reorderEntries(sourceEntryId, targetEntryId)
    setDraggedEntryId(null)
    setDragOverEntryId(null)
  }

  function handleEntryDragEnd() {
    setDraggedEntryId(null)
    setDragOverEntryId(null)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({
        featuredEntries,
        bannerIntervalSeconds: Number.isFinite(normalizedInterval) ? normalizedInterval : config.bannerIntervalSeconds,
        bannerVideoMuted,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="gridPanel settingsPanel">
      <div className="panelHeader">
        <div>
          <p className="sectionTag">Featured Hall</p>
          <h2>Featured Entry Builder</h2>
        </div>
        <div className="featuredEntryPanelActions">
          <button
            className="ghostButton"
            disabled={missingCollections.length === 0}
            type="button"
            onClick={addMissingCollections}
          >
            Add Missing Collections
          </button>
          <button className="ghostButton" type="button" onClick={addEntry}>
            Add Entry
          </button>
        </div>
      </div>

      <div className="settingsList">
        <article className="settingsCard settingsCardWide">
          <div className="settingsBody">
            <div className="featuredEntrySummary">
              <span className="pill">{featuredEntries.length} hall card(s)</span>
              <span className="pill">{missingCollections.length} collection(s) not yet in hall</span>
            </div>

            {featuredEntries.length === 0 ? (
              <div className="emptyState">
                <strong>No featured entries configured.</strong>
                <p>Add one or more featured cards here. Each entry can point at any collection and any media asset.</p>
              </div>
            ) : (
              <div className="featuredEntryList">
                {featuredEntries.map((entry, index) => {
                  const collection = collections.find((candidate) => candidate.id === entry.collectionId) ?? null
                  const availableAssets = collection?.assets ?? []
                  const previewAsset = collection ? getCollectionFeaturedAsset(collection, entry.assetPath) : null
                  const previewUrl = previewAsset ? toAssetUrl(previewAsset.path) : null
                  const previewImageUrl =
                    previewAsset && collection ? getPreviewImageUrl(previewAsset, collection.assets) : null
                  const entryTitle = entry.title.trim() || collection?.displayName || `Featured Card ${index + 1}`
                  const entrySubtitle = entry.subtitle.trim() || `Collection ${collection?.id ?? '000000'}`
                  const isDragSource = draggedEntryId === entry.id
                  const isDropTarget = dragOverEntryId === entry.id && draggedEntryId !== entry.id

                  return (
                    <article
                      className={`featuredEntryCard ${isDragSource ? 'featuredEntryCardDragging' : ''} ${isDropTarget ? 'featuredEntryCardDropTarget' : ''}`}
                      key={entry.id}
                      onDragOver={(event) => handleEntryDragOver(event, entry.id)}
                      onDrop={(event) => handleEntryDrop(event, entry.id)}
                    >
                      <div
                        className="featuredEntryPreview"
                        role={availableAssets.length > 0 ? 'button' : undefined}
                        tabIndex={availableAssets.length > 0 ? 0 : -1}
                        onClick={() => cycleEntryAsset(entry.id, availableAssets, previewAsset, 'next')}
                        onKeyDown={(event) => {
                          if (availableAssets.length === 0) {
                            return
                          }

                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            cycleEntryAsset(entry.id, availableAssets, previewAsset, 'next')
                          }
                        }}
                      >
                        {previewAsset && previewUrl ? (
                          previewAsset.type === 'video' && !previewImageUrl ? (
                            <video autoPlay loop muted playsInline preload="metadata" src={previewUrl} />
                          ) : (
                            <img
                              alt={entry.title || collection?.displayName || `Featured card ${index + 1}`}
                              src={previewImageUrl ?? previewUrl}
                            />
                          )
                        ) : (
                          <div className="collectionPlaceholder">No preview</div>
                        )}

                        <div className="featuredEntryPreviewMeta">
                          <strong>{entryTitle}</strong>
                          <span>{entrySubtitle}</span>
                        </div>
                        {availableAssets.length > 1 ? (
                          <div className="featuredEntryPreviewControls">
                            <button
                              aria-label={`Previous media for featured card ${index + 1}`}
                              className="featuredEntryPreviewNav featuredEntryPreviewNavLeft"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                cycleEntryAsset(entry.id, availableAssets, previewAsset, 'previous')
                              }}
                            />
                            <button
                              aria-label={`Next media for featured card ${index + 1}`}
                              className="featuredEntryPreviewNav featuredEntryPreviewNavRight"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                cycleEntryAsset(entry.id, availableAssets, previewAsset, 'next')
                              }}
                            />
                          </div>
                        ) : null}
                      </div>

                      <div className="featuredEntryContent">
                        <div className="featuredEntryHeader">
                          <div>
                            <strong>Featured Card {index + 1}</strong>
                            <p className="featuredEntryLabel">Hall workbench card</p>
                          </div>
                          <div className="featuredEntryToolbar">
                            <button
                              aria-label={`Drag featured card ${index + 1}`}
                              className="ghostButton featuredEntryAction featuredEntryDragHandle"
                              draggable
                              type="button"
                              onDragEnd={handleEntryDragEnd}
                              onDragStart={(event) => handleEntryDragStart(event, entry.id)}
                            >
                              Drag
                            </button>
                            <button
                              className="ghostButton featuredEntryAction"
                              disabled={index === 0}
                              type="button"
                              onClick={() => moveEntry(entry.id, 'up')}
                            >
                              Move Up
                            </button>
                            <button
                              className="ghostButton featuredEntryAction"
                              disabled={index === featuredEntries.length - 1}
                              type="button"
                              onClick={() => moveEntry(entry.id, 'down')}
                            >
                              Move Down
                            </button>
                            <button
                              className="ghostButton featuredEntryAction"
                              type="button"
                              onClick={() => duplicateEntry(entry.id)}
                            >
                              Duplicate
                            </button>
                            <button
                              className="ghostButton featuredEntryAction featuredEntryDanger"
                              type="button"
                              onClick={() => removeEntry(entry.id)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>

                        <div className="featuredEntryGrid">
                          <label className="settingsField">
                            <span>Collection</span>
                            <select
                              className="settingsSelect"
                              value={entry.collectionId}
                              onChange={(event) =>
                                updateEntry(entry.id, (currentEntry) => ({
                                  ...currentEntry,
                                  collectionId: event.target.value,
                                  assetPath: null,
                                }))
                              }
                            >
                              {collections.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.displayName} ({candidate.id})
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="settingsField">
                            <span>Media</span>
                            <select
                              className="settingsSelect"
                              value={entry.assetPath ?? ''}
                              onChange={(event) =>
                                updateEntry(entry.id, (currentEntry) => ({
                                  ...currentEntry,
                                  assetPath: event.target.value || null,
                                }))
                              }
                            >
                              <option value="">Auto (collection featured / cover)</option>
                              {availableAssets.map((asset) => (
                                <option key={asset.path} value={asset.path}>
                                  [{asset.type === 'image' ? 'Image' : 'Video'}] {asset.name}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="settingsField">
                            <span>Title</span>
                            <input
                              className="settingsInput"
                              type="text"
                              value={entry.title}
                              onChange={(event) =>
                                updateEntry(entry.id, (currentEntry) => ({
                                  ...currentEntry,
                                  title: event.target.value,
                                }))
                              }
                            />
                          </label>

                          <label className="settingsField">
                            <span>Subtitle</span>
                            <input
                              className="settingsInput"
                              type="text"
                              value={entry.subtitle}
                              onChange={(event) =>
                                updateEntry(entry.id, (currentEntry) => ({
                                  ...currentEntry,
                                  subtitle: event.target.value,
                                }))
                              }
                            />
                          </label>
                        </div>

                        <div className="featuredEntryFooter">
                          <label className="settingsToggle">
                            <input
                              checked={entry.enabled}
                              type="checkbox"
                              onChange={(event) =>
                                updateEntry(entry.id, (currentEntry) => ({
                                  ...currentEntry,
                                  enabled: event.target.checked,
                                }))
                              }
                            />
                            <span>Enable this featured card</span>
                          </label>

                          <div className="featuredEntryBadges">
                            <span className="pill">CD.{collection?.id ?? '000000'}</span>
                            <span className="pill">{previewAsset?.type === 'video' ? 'Video' : 'Image'}</span>
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}

            <label className="settingsField">
              <span>Rotation Interval Seconds</span>
              <input
                className="settingsInput"
                min="2"
                step="1"
                type="number"
                value={bannerIntervalSeconds}
                onChange={(event) => setBannerIntervalSeconds(event.target.value)}
              />
            </label>

            <label className="settingsToggle">
              <input
                checked={bannerVideoMuted}
                type="checkbox"
                onChange={(event) => setBannerVideoMuted(event.target.checked)}
              />
              <span>Mute featured banner videos</span>
            </label>

            <p className="settingsHint">
              Featured cards are independent entries now. You can reuse the same collection multiple times with different media, titles, and subtitles.
            </p>

            <div className="settingsActions">
              <button
                className="primaryButton"
                disabled={!bridgeReady || busy || saving || !isDirty}
                type="button"
                onClick={() => void handleSave()}
              >
                {saving ? 'Saving...' : 'Save Banner Settings'}
              </button>
              <button
                className="ghostButton"
                disabled={saving || !isDirty}
                type="button"
                onClick={() => {
                  setFeaturedEntries(config.featuredEntries)
                  setBannerIntervalSeconds(String(config.bannerIntervalSeconds))
                  setBannerVideoMuted(config.bannerVideoMuted)
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}

function CollectionSettingsRow({
  collection,
  busy,
  bridgeReady,
  onSave,
}: {
  collection: CollectionRecord
  busy: boolean
  bridgeReady: boolean
  onSave: (updates: {
    displayName?: string
    manualCoverAsset?: string | null
    featuredAsset?: string | null
  }) => Promise<void>
}) {
  const imageAssets = collection.assets.filter((asset) => asset.type === 'image')
  const mediaAssets = collection.assets
  const [displayName, setDisplayName] = useState(collection.displayName)
  const [manualCoverAsset, setManualCoverAsset] = useState(collection.manualCoverAsset ?? '')
  const [featuredAsset, setFeaturedAsset] = useState(collection.featuredAsset ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDisplayName(collection.displayName)
    setManualCoverAsset(collection.manualCoverAsset ?? '')
    setFeaturedAsset(collection.featuredAsset ?? '')
  }, [collection.displayName, collection.manualCoverAsset, collection.featuredAsset])

  const trimmedDisplayName = displayName.trim()
  const normalizedManualCoverAsset = manualCoverAsset || null
  const normalizedFeaturedAsset = featuredAsset || null
  const isDirty =
    trimmedDisplayName !== collection.displayName ||
    normalizedManualCoverAsset !== (collection.manualCoverAsset ?? null) ||
    normalizedFeaturedAsset !== (collection.featuredAsset ?? null)

  const effectivePreviewAsset =
    collection.assets.find((asset) => asset.path === normalizedFeaturedAsset) ??
    collection.assets.find((asset) => asset.path === (normalizedManualCoverAsset ?? '')) ??
    collection.assets.find((asset) => asset.path === (collection.coverAsset ?? '')) ??
    null
  const previewImageUrl = effectivePreviewAsset ? getPreviewImageUrl(effectivePreviewAsset, collection.assets) : null
  const previewAssetUrl = effectivePreviewAsset ? toAssetUrl(effectivePreviewAsset.path) : null

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({
        displayName: trimmedDisplayName || collection.displayName,
        manualCoverAsset: normalizedManualCoverAsset,
        featuredAsset: normalizedFeaturedAsset,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="settingsCard">
      <div className="settingsPreview">
        {effectivePreviewAsset && previewAssetUrl ? (
          effectivePreviewAsset.type === 'video' && !previewImageUrl ? (
            <video autoPlay loop muted playsInline src={previewAssetUrl} />
          ) : (
            <img alt={collection.displayName} src={previewImageUrl ?? previewAssetUrl} />
          )
        ) : (
          <div className="collectionPlaceholder">No cover</div>
        )}
      </div>

      <div className="settingsBody">
        <div className="settingsHeading">
          <div className="viewerInfoCard">
            <p className="sectionTag">Collection {collection.id}</p>
            <h3>{collection.displayName}</h3>
          </div>
          <span className="pill">
            {collection.assetCount} assets · {collection.imageCount} images · {collection.videoCount} videos
          </span>
        </div>

        <label className="settingsField">
          <span>Display Name</span>
          <input
            className="settingsInput"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>

        <label className="settingsField">
          <span>Manual Cover</span>
          <select
            className="settingsSelect"
            disabled={imageAssets.length === 0}
            value={manualCoverAsset}
            onChange={(event) => setManualCoverAsset(event.target.value)}
          >
            <option value="">Auto (first available image)</option>
            {imageAssets.map((asset) => (
              <option key={asset.path} value={asset.path}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>

        <label className="settingsField">
          <span>Featured Media</span>
          <select
            className="settingsSelect"
            disabled={mediaAssets.length === 0}
            value={featuredAsset}
            onChange={(event) => setFeaturedAsset(event.target.value)}
          >
            <option value="">Auto (use collection cover)</option>
            {mediaAssets.map((asset) => (
              <option key={asset.path} value={asset.path}>
                [{asset.type === 'image' ? 'Image' : 'Video'}] {asset.name}
              </option>
            ))}
          </select>
        </label>

        <p className="settingsHint">
          {imageAssets.length > 0
            ? `Current folder: ${collection.folderPath}`
            : `No image asset found in ${collection.folderPath}, so manual cover selection is unavailable. Featured Media can still use videos.`}
        </p>

        <div className="settingsActions">
          <button
            className="primaryButton"
            disabled={!bridgeReady || busy || saving || !isDirty}
            type="button"
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="ghostButton"
            disabled={saving || !isDirty}
            type="button"
            onClick={() => {
              setDisplayName(collection.displayName)
              setManualCoverAsset(collection.manualCoverAsset ?? '')
              setFeaturedAsset(collection.featuredAsset ?? '')
            }}
          >
            Reset
          </button>
        </div>

      </div>
    </article>
  )
}

function FeaturedFullscreenOverlay({
  collection,
  src,
  mediaType,
  muted,
  onClose,
}: {
  collection: CollectionRecord
  src: string
  mediaType: 'image' | 'video' | null
  muted: boolean
  onClose: () => void
}) {
  usePageScrollLock(true)
  const [isMuted, setIsMuted] = useState(muted)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="viewerOverlay" role="dialog" aria-modal="true" onWheel={(event) => event.preventDefault()}>
      <div className="featuredFullscreenBackdrop" onClick={onClose} />

      <div className="featuredFullscreenShell">
        {mediaType === 'video' ? (
          <button
            aria-label={isMuted ? 'Unmute video' : 'Mute video'}
            className="viewerAudioToggle"
            type="button"
            onClick={() => setIsMuted((current) => !current)}
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
        ) : null}
        <button
          aria-label={`Close featured view for ${collection.displayName}`}
          className="featuredFullscreenClose"
          type="button"
          onClick={onClose}
        >
          脳
        </button>

        <div className="featuredFullscreenStage">
          {mediaType === 'video' ? (
            <video
              autoPlay
              className="viewerVideo"
              controls={false}
              key={src}
              loop
              muted={isMuted}
              playsInline
              src={src}
            />
          ) : (
            <img alt={collection.displayName} className="viewerImage" src={src} />
          )}
        </div>

      </div>
    </div>
  )
}

function HallFullscreenOverlay({
  config,
  title,
  src,
  mediaType,
  muted,
  onNext,
  onClose,
}: {
  config: GalleryState['config']
  title: string
  src: string
  mediaType: 'image' | 'video' | null
  muted: boolean
  onNext: () => void
  onClose: () => void
}) {
  usePageScrollLock(true)
  const [isMuted, setIsMuted] = useState(muted)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!config.fullscreenSlideshowEnabled) {
      return
    }

    if (mediaType === 'video' && config.fullscreenVideoAdvanceOnEnded) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      onNext()
    }, config.fullscreenSlideshowIntervalSeconds * 1000)

    return () => window.clearTimeout(timeoutId)
  }, [
    config.fullscreenSlideshowEnabled,
    config.fullscreenSlideshowIntervalSeconds,
    config.fullscreenVideoAdvanceOnEnded,
    mediaType,
    onNext,
    src,
  ])

  return (
    <div
      className="viewerOverlay hallFullscreenOverlay"
      role="dialog"
      aria-modal="true"
      onWheel={(event) => event.preventDefault()}
    >
      <div className="hallFullscreenBackdrop" onClick={onClose} />
      <div className="hallFullscreenShell">
        {mediaType === 'video' ? (
          <button
            aria-label={isMuted ? 'Unmute video' : 'Mute video'}
            className="viewerAudioToggle"
            type="button"
            onClick={() => setIsMuted((current) => !current)}
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
        ) : null}
        <button
          aria-label={`Close fullscreen view for ${title}`}
          className="featuredFullscreenClose"
          type="button"
          onClick={onClose}
        />

        <div className="hallFullscreenStage">
          {mediaType === 'video' ? (
            <video
              autoPlay
              className="hallFullscreenMedia"
              controls={false}
              loop={!config.fullscreenSlideshowEnabled || !config.fullscreenVideoAdvanceOnEnded}
              muted={isMuted}
              onEnded={() => {
                if (config.fullscreenSlideshowEnabled && config.fullscreenVideoAdvanceOnEnded) {
                  onNext()
                }
              }}
              playsInline
              src={src}
            />
          ) : (
            <img alt={title} className="hallFullscreenMedia" src={src} />
          )}
        </div>
      </div>
    </div>
  )
}

function CollectionCard({
  collection,
  onOpen,
}: {
  collection: CollectionRecord
  onOpen: () => void
}) {
  const coverUrl = collection.coverAsset ? toAssetUrl(collection.coverAsset) : null

  return (
    <button className="collectionCard" type="button" onClick={onOpen}>
      <div className="collectionCover">
        {coverUrl ? (
          <img alt={collection.displayName} src={coverUrl} />
        ) : (
          <div className="collectionPlaceholder">No preview</div>
        )}
      </div>
      <div className="collectionMeta">
        <strong>{collection.displayName}</strong>
        <span>ID {collection.id}</span>
        <span>
          {collection.imageCount} images · {collection.videoCount} videos
        </span>
      </div>
    </button>
  )
}

function CollectionDetailPage() {
  const { collectionId } = useParams()
  const { galleryState, loading } = useGallery()
  const navigate = useNavigate()
  const collection = galleryState.collections.find((entry) => entry.id === collectionId)
  const [activeViewerState, setActiveViewerState] = useState<{ collectionId: string; assetIndex: number } | null>(null)

  const viewerCollection =
    activeViewerState === null
      ? null
      : galleryState.collections.find((entry) => entry.id === activeViewerState.collectionId) ?? null
  const activeAsset =
    activeViewerState === null || !viewerCollection ? null : viewerCollection.assets[activeViewerState.assetIndex] ?? null

  useEffect(() => {
    if (activeViewerState === null || !viewerCollection) {
      return
    }

    const assetCount = viewerCollection.assets.length

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveViewerState(null)
      } else if (event.key === 'ArrowRight') {
        setActiveViewerState((currentState) => {
          if (currentState === null) {
            return currentState
          }
          return {
            ...currentState,
            assetIndex: (currentState.assetIndex + 1) % assetCount,
          }
        })
      } else if (event.key === 'ArrowLeft') {
        setActiveViewerState((currentState) => {
          if (currentState === null) {
            return currentState
          }
          return {
            ...currentState,
            assetIndex: (currentState.assetIndex - 1 + assetCount) % assetCount,
          }
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeViewerState, viewerCollection])

  if (loading && !collection) {
    return (
      <div className="shell">
        <div className="statusBanner">Loading collection...</div>
      </div>
    )
  }

  if (!collection) {
    return (
      <div className="shell">
        <header className="detailTopbar">
          <button className="ghostButton" type="button" onClick={() => navigate('/')}>
            Back
          </button>
        </header>
        <div className="emptyState">
          <strong>Collection not found.</strong>
          <p>The selected collection is unavailable in the current local index.</p>
        </div>

      </div>
    )
  }

  const resolvedCollection = collection

  function showRandomViewerAsset() {
    const collectionsWithAssets = galleryState.collections.filter((entry) => entry.assets.length > 0)
    if (collectionsWithAssets.length === 0) {
      return
    }

    setActiveViewerState((currentState) => {
      const randomCollection = collectionsWithAssets[Math.floor(Math.random() * collectionsWithAssets.length)]
      const randomAssetIndex = Math.floor(Math.random() * randomCollection.assets.length)

      if (
        currentState &&
        collectionsWithAssets.length === 1 &&
        randomCollection.id === currentState.collectionId &&
        randomCollection.assets.length > 1 &&
        randomAssetIndex === currentState.assetIndex
      ) {
        return {
          collectionId: randomCollection.id,
          assetIndex: (randomAssetIndex + 1) % randomCollection.assets.length,
        }
      }

      return {
        collectionId: randomCollection.id,
        assetIndex: randomAssetIndex,
      }
    })
  }

  return (
    <div className="shell">
      <header className="detailTopbar">
        <div className="detailTitleBlock">
          <button className="ghostButton" type="button" onClick={() => navigate('/')}>
            Back
          </button>
          <div className="viewerInfoCard">
            <p className="eyebrow">Collection Detail</p>
            <h1>{collection.displayName}</h1>
            <p className="subtitle">
              ID {collection.id} · {collection.assetCount} assets · {collection.imageCount} images · {' '}
              {collection.videoCount} videos
            </p>
          </div>
        </div>
      </header>

      <main className="detailLayout">
        <section className="detailHero">
          <div className="detailCover">
              {resolvedCollection.coverAsset ? (
                <img alt={resolvedCollection.displayName} src={toAssetUrl(resolvedCollection.coverAsset)} />
              ) : (
                <div className="featuredPlaceholder">No cover yet</div>
              )}
            </div>
          <div className="detailMeta">
            <p className="sectionTag">Collection Overview</p>
            <h2>{resolvedCollection.displayName}</h2>
            <p className="subtitle detailCopy">
              This page shows every indexed asset in the current collection folder. Open any item
              to enter the fullscreen viewer and browse left or right.
            </p>
            <div className="detailStats">
              <span className="pill">Folder: {resolvedCollection.folderPath}</span>
              <span className="pill">Updated: {new Date(resolvedCollection.updatedAt).toLocaleString()}</span>
            </div>
          </div>
        </section>

        <section className="gridPanel">
          <div className="panelHeader">
            <div>
              <p className="sectionTag">Assets</p>
              <h2>{resolvedCollection.assets.length} media item(s)</h2>
            </div>
          </div>

          {resolvedCollection.assets.length === 0 ? (
            <div className="emptyState">
              <strong>No media files found.</strong>
              <p>This collection folder is indexed but does not contain supported image or video assets.</p>
            </div>
          ) : (
            <div className="assetGrid">
              {resolvedCollection.assets.map((asset, index) => (
                <AssetCard
                  asset={asset}
                  key={asset.path}
                  onOpen={() => setActiveViewerState({ collectionId: resolvedCollection.id, assetIndex: index })}
                  previewImageUrl={getPreviewImageUrl(asset, resolvedCollection.assets)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {activeAsset ? (
        <FullscreenViewer
          asset={activeAsset}
          assetIndex={activeViewerState?.assetIndex ?? 0}
          collection={viewerCollection ?? resolvedCollection}
          config={galleryState.config}
          onClose={() => setActiveViewerState(null)}
          onNext={() =>
            setActiveViewerState((currentState) =>
              currentState === null || !viewerCollection
                ? currentState
                : {
                    ...currentState,
                    assetIndex: (currentState.assetIndex + 1) % viewerCollection.assets.length,
                  },
            )
          }
          onPrevious={() =>
            setActiveViewerState((currentState) =>
              currentState === null || !viewerCollection
                ? currentState
                : {
                    ...currentState,
                    assetIndex: (currentState.assetIndex - 1 + viewerCollection.assets.length) % viewerCollection.assets.length,
                  },
            )
          }
          onAutoAdvance={
            galleryState.config.fullscreenSlideshowShuffleAllCollections ? showRandomViewerAsset : undefined
          }
          onSelect={(index) =>
            setActiveViewerState((currentState) =>
              currentState === null ? currentState : { ...currentState, assetIndex: index },
            )
          }
        />
      ) : null}
    </div>
  )
}

function getAssetStem(name: string) {
  const dotIndex = name.lastIndexOf('.')
  return dotIndex >= 0 ? name.slice(0, dotIndex) : name
}

function getPreviewImageUrl(asset: GalleryAsset, assets: GalleryAsset[]) {
  if (asset.type === 'image') {
    return toAssetUrl(asset.path)
  }

  const imageMatch = assets.find(
    (candidate) => candidate.type === 'image' && getAssetStem(candidate.name) === getAssetStem(asset.name),
  )

  return imageMatch ? toAssetUrl(imageMatch.path) : null
}

function AssetCard({
  asset,
  onOpen,
  previewImageUrl,
}: {
  asset: GalleryAsset
  onOpen: () => void
  previewImageUrl: string | null
}) {
  const assetUrl = toAssetUrl(asset.path)

  return (
    <button className="assetCard" type="button" onClick={onOpen}>
      <div className="assetPreview">
        {previewImageUrl ? (
          <img alt={asset.name} src={previewImageUrl} />
        ) : (
          <video autoPlay loop muted playsInline preload="metadata" src={assetUrl} />
        )}
        {asset.type === 'video' ? <span className="assetBadge">Video</span> : null}
      </div>
      <div className="assetMeta">
        <strong title={asset.name}>{asset.name}</strong>
        <span>{asset.type === 'image' ? 'Image' : 'Video'}</span>
      </div>
    </button>
  )
}

function ViewerThumbnailRail({
  assets,
  activeIndex,
  onSelect,
}: {
  assets: GalleryAsset[]
  activeIndex: number
  onSelect: (index: number) => void
}) {
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    const activeThumbnail = thumbnailRefs.current[activeIndex]
    if (!activeThumbnail) {
      return
    }

    activeThumbnail.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    })
  }, [activeIndex, assets.length])

  return (
    <div className="viewerThumbDock">
      <div aria-hidden="true" className="viewerThumbHotspot" />

      <div className="viewerThumbPanel">
        <div className="viewerThumbRail">
          {assets.map((entry, index) => {
            const thumbPreviewImageUrl = getPreviewImageUrl(entry, assets)
            const thumbUrl = toAssetUrl(entry.path)

            return (
              <button
                aria-current={index === activeIndex ? 'true' : undefined}
                className={`viewerThumbButton ${index === activeIndex ? 'viewerThumbButtonActive' : ''}`}
                key={entry.path}
                ref={(node) => {
                  thumbnailRefs.current[index] = node
                }}
                type="button"
                onClick={() => onSelect(index)}
              >
                <div className="viewerThumbMedia">
                  {thumbPreviewImageUrl ? (
                    <img alt={entry.name} src={thumbPreviewImageUrl} />
                  ) : (
                    <video muted playsInline preload="metadata" src={thumbUrl} />
                  )}
                  {entry.type === 'video' ? <span className="assetBadge">Video</span> : null}
                </div>
                <span className="viewerThumbLabel" title={entry.name}>
                  {entry.name}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function FullscreenViewer({
  asset,
  assetIndex,
  collection,
  config,
  onClose,
  onNext,
  onPrevious,
  onAutoAdvance,
  onSelect,
}: {
  asset: GalleryAsset
  assetIndex: number
  collection: CollectionRecord
  config: GalleryState['config']
  onClose: () => void
  onNext: () => void
  onPrevious: () => void
  onAutoAdvance?: () => void
  onSelect: (index: number) => void
}) {
  usePageScrollLock(true)
  const [mutedByAssetPath, setMutedByAssetPath] = useState<Record<string, boolean>>({})

  const assetUrl = toAssetUrl(asset.path)
  const previewImageUrl = getPreviewImageUrl(asset, collection.assets)
  const isMuted = mutedByAssetPath[asset.path] ?? false

  useEffect(() => {
    if (!config.fullscreenSlideshowEnabled) {
      return
    }

    if (asset.type === 'video' && config.fullscreenVideoAdvanceOnEnded) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (config.fullscreenSlideshowShuffleAllCollections && onAutoAdvance) {
        onAutoAdvance()
        return
      }

      onNext()
    }, config.fullscreenSlideshowIntervalSeconds * 1000)

    return () => window.clearTimeout(timeoutId)
  }, [
    asset.path,
    asset.type,
    config.fullscreenSlideshowEnabled,
    config.fullscreenSlideshowIntervalSeconds,
    config.fullscreenVideoAdvanceOnEnded,
    config.fullscreenSlideshowShuffleAllCollections,
    onNext,
    onAutoAdvance,
  ])

  return (
    <div className="viewerOverlay" role="dialog" aria-modal="true" onWheel={(event) => event.preventDefault()}>
      <div className="viewerBackdrop" onClick={onClose} />

      <div className="viewerShell">
        <div className="viewerTopLayer">
          {asset.type === 'video' ? (
            <button
              aria-label={isMuted ? 'Unmute video' : 'Mute video'}
              className="viewerAudioToggle"
              type="button"
              onClick={() =>
                setMutedByAssetPath((current) => ({
                  ...current,
                  [asset.path]: !(current[asset.path] ?? false),
                }))
              }
            >
              {isMuted ? 'Unmute' : 'Mute'}
            </button>
          ) : (
            <div className="viewerActionSpacer" />
          )}
          <div className="viewerInfoCard">
            <p className="sectionTag">Collection Viewer</p>
            <strong className="viewerTitle">{collection.displayName}</strong>
            <p className="viewerMeta">
              {assetIndex + 1} / {collection.assets.length} · {asset.name}
            </p>
          </div>
          <button aria-label="Close viewer" className="featuredFullscreenClose" type="button" onClick={onClose} />
        </div>

        <div className="viewerStage">
          <button aria-label="Previous asset" className="viewerNav viewerNavLeft" type="button" onClick={onPrevious} />

          <div className="viewerMediaFrame">
            {previewImageUrl ? <img alt="" className="viewerBackdropArt" src={previewImageUrl} /> : null}
            {asset.type === 'image' ? (
              <img alt={asset.name} className="viewerImage" src={assetUrl} />
            ) : (
              <video
                autoPlay
                className="viewerVideo"
                controls
                loop={!config.fullscreenSlideshowEnabled || !config.fullscreenVideoAdvanceOnEnded}
                onEnded={() => {
                  if (config.fullscreenSlideshowEnabled && config.fullscreenVideoAdvanceOnEnded) {
                    if (config.fullscreenSlideshowShuffleAllCollections && onAutoAdvance) {
                      onAutoAdvance()
                      return
                    }

                    onNext()
                  }
                }}
                muted={isMuted}
                playsInline
                poster={previewImageUrl ?? undefined}
                src={assetUrl}
              />
            )}
          </div>

          <button aria-label="Next asset" className="viewerNav viewerNavRight" type="button" onClick={onNext} />
        </div>

        <ViewerThumbnailRail
          activeIndex={assetIndex}
          assets={collection.assets}
          onSelect={onSelect}
        />
      </div>
    </div>
  )
}

export default App
