import { TabBar, Toasts } from './components/Common'
import ExitGuard from './components/ExitGuard'
import Onboarding from './components/Onboarding'
import { StoreProvider, useStore } from './data/store'
import { TAB_ROUTES, useRoute } from './lib/route'
import HomePage from './pages/Home'
import FeedPage from './pages/Feed'
import GrowthPage from './pages/Growth'
import AlbumPage from './pages/Album'
import ProfilePage from './pages/Profile'
import BabyProfilePage from './pages/BabyProfile'
import RemindersPage from './pages/Reminders'
import AboutPage from './pages/About'
import SettingsPage from './pages/Settings'

function Shell() {
  const { route, mode, viewKey } = useRoute()
  const { state } = useStore()
  const isTab = TAB_ROUTES.includes(route)

  if (state.onboarded === false) {
    return (
      <div className="app app--onboarding">
        <Onboarding />
        <Toasts />
      </div>
    )
  }

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
        {route === 'baby' ? <BabyProfilePage /> : null}
        {route === 'reminders' ? <RemindersPage /> : null}
        {route === 'about' ? <AboutPage /> : null}
        {route === 'settings' ? <SettingsPage /> : null}
      </div>
      {isTab ? <TabBar active={route} /> : null}
      <ExitGuard route={route} />
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
