import { useQuery } from '@tanstack/react-query'
import { Home, Loader2, SearchX, ShieldX } from 'lucide-react'
import { Link, Route, Routes } from 'react-router'
import { Sidebar } from './components/layout/Sidebar'
import { getMe } from './lib/api'
import { accessLoginUrl, resolveAuthState } from './lib/auth-state'
import { queryKeys } from './lib/queryKeys'
import { AuditPage } from './pages/AuditPage'
import { ContactsPage } from './pages/ContactsPage'
import { DeliverabilityPage } from './pages/DeliverabilityPage'
import { LeadMagnetsPage } from './pages/LeadMagnetsPage'
import { OverviewPage } from './pages/OverviewPage'
import { ProductsPage } from './pages/ProductsPage'
import { SequencesPage } from './pages/SequencesPage'
import { SettingsPage } from './pages/SettingsPage'
import { SuppressionsPage } from './pages/SuppressionsPage'
import { TemplatesPage } from './pages/TemplatesPage'

const LOGIN_ATTEMPT_KEY = 'seq.auth.loginAttempted'

function hasTriedLogin(): boolean {
  try {
    return sessionStorage.getItem(LOGIN_ATTEMPT_KEY) === '1'
  } catch {
    return false
  }
}

function clearLoginAttempt(): void {
  try {
    sessionStorage.removeItem(LOGIN_ATTEMPT_KEY)
  } catch {
    // sessionStorage may be unavailable (private mode); ignore.
  }
}

function goToAccessLogin(): void {
  const path = window.location.pathname + window.location.search
  try {
    sessionStorage.setItem(LOGIN_ATTEMPT_KEY, '1')
  } catch {
    // ignore — we still attempt the navigation below.
  }
  window.location.assign(accessLoginUrl(path))
}

function SignInButton() {
  return (
    <button
      type="button"
      onClick={goToAccessLogin}
      className="mt-6 inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
    >
      Sign in with Cloudflare Access
    </button>
  )
}

function AccessDenied() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center max-w-sm px-6">
        <ShieldX size={48} className="mx-auto text-slate-300 mb-4" />
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Access Denied</h1>
        <p className="text-sm text-slate-500">
          You are not signed in. Sign in to <strong>Cloudflare Access</strong> with an approved
          email to open the dashboard.
        </p>
        <SignInButton />
      </div>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <Loader2 size={28} className="animate-spin text-slate-400" />
    </div>
  )
}

function AccessConfigError({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center max-w-sm px-6">
        <ShieldX size={48} className="mx-auto text-red-300 mb-4" />
        <h1 className="text-xl font-semibold text-slate-900 mb-2">Access Check Failed</h1>
        <p className="text-sm text-slate-500">{message}</p>
        <SignInButton />
      </div>
    </div>
  )
}

function NotFoundPage() {
  return (
    <div className="min-h-full px-6 py-10">
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <SearchX size={40} className="mb-4 text-slate-300" />
        <h1 className="text-xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          This dashboard route does not exist or has moved.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          <Home size={14} />
          Return to overview
        </Link>
      </div>
    </div>
  )
}

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 md:h-screen md:flex-row">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-slate-900 focus:px-3 focus:py-1.5 focus:text-sm focus:text-white"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/sequences" element={<SequencesPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/lead-magnets" element={<LeadMagnetsPage />} />
          <Route path="/suppressions" element={<SuppressionsPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/deliverability" element={<DeliverabilityPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  )
}

export function App() {
  const { isLoading, error } = useQuery({
    queryKey: queryKeys.me(),
    queryFn: getMe,
    retry: false,
  })

  const state = resolveAuthState({
    isLoading,
    error,
    isDev: import.meta.env.DEV,
    alreadyTriedLogin: hasTriedLogin(),
  })

  switch (state.kind) {
    case 'loading':
      return <LoadingSpinner />
    case 'login':
      // Bounce through Cloudflare Access to establish a session, then return here.
      goToAccessLogin()
      return <LoadingSpinner />
    case 'denied':
      return <AccessDenied />
    case 'config-error':
      return <AccessConfigError message={state.message} />
    default:
      clearLoginAttempt()
      return <AppShell />
  }
}
