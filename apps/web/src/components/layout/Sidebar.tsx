import {
  Activity,
  Ban,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Magnet,
  Mail,
  Package,
  Settings,
  Users,
  Zap,
} from 'lucide-react'
import { NavLink } from 'react-router'

interface NavSection {
  label: string
  items: Array<{ to: string; label: string; icon: React.FC<{ size?: number }> }>
}

const navSections: NavSection[] = [
  {
    label: '',
    items: [{ to: '/', label: 'Overview', icon: LayoutDashboard }],
  },
  {
    label: 'Email',
    items: [
      { to: '/sequences', label: 'Sequences', icon: Mail },
      { to: '/contacts', label: 'Contacts', icon: Users },
      { to: '/lead-magnets', label: 'Lead Magnets', icon: Magnet },
      { to: '/suppressions', label: 'Block list', icon: Ban },
      { to: '/templates', label: 'Templates', icon: FileText },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/deliverability', label: 'Deliverability', icon: Activity },
      { to: '/audit', label: 'Audit Log', icon: ClipboardList },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/products', label: 'Products', icon: Package },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

export function Sidebar() {
  return (
    <aside
      aria-label="Primary"
      className="flex shrink-0 flex-col border-b border-slate-200 bg-white md:h-screen md:w-56 md:border-b-0 md:border-r"
    >
      {/* Logo */}
      <div className="px-4 py-3 border-b border-slate-100 md:py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white">
            <Zap size={14} />
          </span>
          <div>
            <p className="text-xs font-bold text-slate-900 leading-tight">Ventora</p>
            <p className="text-xs text-slate-500 leading-tight">Sequencer</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav
        aria-label="Dashboard navigation"
        className="flex flex-wrap gap-1 px-2 py-2 md:flex-1 md:flex-none md:block md:gap-0 md:overflow-y-auto md:py-3"
      >
        {navSections.map((section) => (
          <div key={section.label} className="contents md:mb-3 md:block">
            {section.label && (
              <p className="hidden px-3 mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wider md:block">
                {section.label}
              </p>
            )}
            <div className="contents md:block md:space-y-0.5">
              {section.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                >
                  <Icon size={15} aria-hidden="true" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="hidden px-4 py-3 border-t border-slate-100 md:block">
        <p className="text-xs text-slate-500">Protected by Cloudflare Access</p>
      </div>
    </aside>
  )
}
