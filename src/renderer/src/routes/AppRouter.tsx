import { createHashRouter, Navigate, RouterProvider } from 'react-router'
import { AppLayout, AppRouteErrorPage } from '@renderer/components'
import {
  AboutPage,
  HomePage,
  FavoritesPage,
  HotPage,
  LivePage,
  VodPage,
  RecentPage,
  SearchPage,
  SettingsPage,
} from '@renderer/pages'

const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <AppRouteErrorPage />,
    children: [
      { index: true, element: <HomePage />, handle: { showGlobalSearch: true } },
      { path: 'hot', element: <Navigate replace to="/hot/movie" /> },
      { path: 'hot/:category', element: <HotPage />, handle: { showGlobalSearch: true } },

      { path: 'recent', element: <RecentPage />, handle: { hideTopBar: true } },
      { path: 'favorites', element: <FavoritesPage />, handle: { hideTopBar: true } },

      { path: 'settings', element: <SettingsPage />, handle: { hideTopBar: true } },
      { path: 'about', element: <AboutPage />, handle: { hideTopBar: true } },

      { path: 'search', element: <SearchPage />, handle: { showGlobalSearch: true } },
      { path: 'live', element: <LivePage />, handle: { hideTopBar: true } },
      { path: 'vod/:sourceId/:vodId', element: <VodPage />, handle: { hideTopBar: true } },
    ],
  },
])

export function AppRouter(): React.JSX.Element {
  return <RouterProvider router={router} />
}
