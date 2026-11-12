import { TabBar, Toasts } from './components/Common'
import { StoreProvider } from './data/store'
import { useRoute } from './lib/route'
import type { Route } from './lib/route'
import HomePage from './pages/Home'
import FeedPage from './pages/Feed'
import GrowthPage from './pages/Growth'
import AlbumPage from './pages/Album'
import ProfilePage from './pages/Profile'
import RemindersPage from './pages/Reminders'
import AboutPage from './pages/About'
import SettingsPage from './pages/Settings'

const TAB_ROUTES: Route[] = ['home', 'growth', 'album', 'profile']

function Shell() {
  const { route, mode, viewKey } = useRoute()
  const isTab = TAB_ROUTES.includes(route)

  return (
    <div className="app">
      <div
        className={`route-view${mode === 'back' ? ' route-view--back' : ''}`}
        key={viewKey}
      >
        {route === 'home' ? <HomePage /> : null}
        {route === 'feed' ? <FeedPage /> : null}
        {route === 'record' ? <FeedPage mode="quick" /> : null}
        {route === 'growth' ? <GrowthPage /> : null}
        {route === 'album' ? <AlbumPage /> : null}
        {route === 'profile' ? <ProfilePage /> : null}
        {route === 'reminders' ? <RemindersPage /> : null}
        {route === 'about' ? <AboutPage /> : null}
        {route === 'settings' ? <SettingsPage /> : null}
      </div>
      {isTab ? <TabBar active={route} /> : null}
      <Toasts />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}
