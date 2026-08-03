import { createHashRouter, Navigate, RouterProvider } from 'react-router'
import { AppLayout, AppRouteErrorPage } from '@renderer/components'
import {
  AboutPage,
  CatalogHomePage,
  HomePage,
  FavoritesPage,
  HotPage,
  LinkPlayerPage,
  LivePage,
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
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <AppRouteErrorPage />,
    children: [
      { index: true, element: <StyleHomePage /> },
      { path: 'hot', element: <Navigate replace to="/hot/movie" /> },
      { path: 'hot/:category', element: <HotPage />, handle: { showGlobalSearch: true } },

      { path: 'recent', element: <RecentPage />, handle: { hideTopBar: true } },
      { path: 'favorites', element: <FavoritesPage />, handle: { hideTopBar: true } },

      { path: 'settings', element: <SettingsPage />, handle: { hideTopBar: true } },
      { path: 'about', element: <AboutPage />, handle: { hideTopBar: true } },

      { path: 'search', element: <SearchPage />, handle: { showGlobalSearch: true } },
      { path: 'live', element: <LivePage />, handle: { hideTopBar: true } },
      { path: 'radio', element: <RadioPage />, handle: { hideTopBar: true } },
      { path: 'link-player', element: <LinkPlayerPage />, handle: { hideTopBar: true } },
      { path: 'vod/:sourceId/:vodId', element: <VodPage />, handle: { hideTopBar: true } },
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
