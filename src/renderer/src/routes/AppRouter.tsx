import { createHashRouter, RouterProvider } from 'react-router'
import { AppLayout } from '@renderer/components'
import {
  AboutPage,
  HomePage,
  FavoritesPage,
  HotPage,
  PlayerPage,
  RecentPage,
  SearchPage,
  SettingsPage,
} from '@renderer/pages'

const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage />, handle: { showGlobalSearch: true } },
      { path: 'recent', element: <RecentPage /> },
      { path: 'favorites', element: <FavoritesPage /> },
      { path: 'hot', element: <HotPage />, handle: { showGlobalSearch: true } },
      { path: 'search', element: <SearchPage />, handle: { showGlobalSearch: true } },
      { path: 'settings', element: <SettingsPage />, handle: { hideTopBar: true } },
      { path: 'about', element: <AboutPage />, handle: { hideTopBar: true } },
    ],
  },
  {
    path: '/player/:sourceId/:vodId',
    element: <PlayerPage />,
  },
])

export function AppRouter(): React.JSX.Element {
  return <RouterProvider router={router} />
}
