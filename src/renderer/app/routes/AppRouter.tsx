import { createHashRouter, Navigate, RouterProvider, useParams, useSearchParams } from 'react-router'
import { AppLayout, AppRouteErrorPage } from '@renderer/components'
import {
  CatalogHomePage,
  HomePage,
  FavoritesPage,
  LinkPlayerPage,
  IptvPage,
  IptvPlayerPage,
  MiniWindowPage,
  VodPage,
  RecentPage,
  RadioPage,
  SearchPage,
  SettingsPage,
} from '@renderer/pages'
import { useLayoutPreferencesStore } from '@/stores'

const router = createHashRouter([
  { path: 'mini-window', element: <MiniWindowPage /> },
  { path: 'settings', element: <SettingsWindowRoute /> },
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <AppRouteErrorPage />,
    children: [
      { index: true, element: <StyleHomePage /> },
      { path: 'hot', element: <LegacyHotRedirect /> },
      { path: 'hot/:category', element: <LegacyHotRedirect /> },

      { path: 'recent', element: <RecentPage /> },
      { path: 'favorites', element: <FavoritesPage /> },

      { path: 'about', element: <Navigate replace to="/" /> },

      { path: 'search', element: <SearchPage /> },
      { path: 'iptv', element: <IptvPage /> },
      { path: 'iptv/:sourceId/:channelId', element: <IptvPlayerPage /> },
      { path: 'radio', element: <RadioPage /> },
      { path: 'link-player', element: <LinkPlayerPage /> },
      { path: 'vod/:sourceId/:vodId', element: <VodPage /> },
    ],
  },
])

export function AppRouter(): React.JSX.Element {
  return <RouterProvider router={router} />
}

function StyleHomePage(): React.JSX.Element {
  const appStyle = useLayoutPreferencesStore((state) => state.appStyle)
  return appStyle === 'catalog' ? <CatalogHomePage /> : <HomePage />
}

function SettingsWindowRoute(): React.JSX.Element {
  return (
    <main className="bg-background text-foreground h-screen overflow-y-auto">
      <SettingsPage />
    </main>
  )
}

function LegacyHotRedirect(): React.JSX.Element {
  const { category = 'movie' } = useParams()
  const [searchParams] = useSearchParams()
  const next = new URLSearchParams()
  next.set('doubanCategory', category)
  const type = searchParams.get('type')
  if (type) next.set('doubanType', type)
  return <Navigate replace to={`/?${next.toString()}`} />
}
