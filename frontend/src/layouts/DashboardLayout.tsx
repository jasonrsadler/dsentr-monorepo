// src/layouts/DashboardLayout.tsx
import { useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { NavigateButton } from '@/components/UI/Buttons/NavigateButton'
import { useAuth } from '@/stores/auth'
import SettingsButton from '@/components/Settings/SettingsButton'
import SettingsModal from '@/components/Settings/SettingsModal'
import WorkflowsTab from '@/components/Settings/tabs/WorkflowsTab'
import EngineTab from '@/components/Settings/tabs/EngineTab'
import LogsTab from '@/components/Settings/tabs/LogsTab'
import WebhooksTab from '@/components/Settings/tabs/WebhooksTab'
import OptionsTab from '@/components/Settings/tabs/OptionsTab'
import IntegrationsTab, {
  IntegrationNotice
} from '@/components/Settings/tabs/IntegrationsTab'
import PlanTab from '@/components/Settings/tabs/PlanTab'
import MembersTab from '@/components/Settings/tabs/MembersTab'
import TeamsTab from '@/components/Settings/tabs/TeamsTab'
import { DsentrLogo } from '@/components/DsentrLogo'
import { SecretsProvider } from '@/contexts/SecretsContext'
import { OAuthProvider } from '@/lib/oauthApi'

export default function DashboardLayout() {
  const { user, memberships } = useAuth()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [initialSettingsTab, setInitialSettingsTab] = useState<
    string | undefined
  >(undefined)
  const [integrationNotice, setIntegrationNotice] =
    useState<IntegrationNotice | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  // Preferences removed

  const planLabel = useMemo(() => {
    if (!user?.plan) return null
    const normalized = user.plan.trim()
    if (!normalized) return null
    return normalized.charAt(0).toUpperCase() + normalized.slice(1)
  }, [user?.plan])

  // Workspace / Team switchers (local context)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [workspaceTeams, setWorkspaceTeams] = useState<{ id: string; name: string }[]>([])
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null)

  useEffect(() => {
    // Initialize workspace from first membership if not set
    if (!activeWorkspaceId && Array.isArray(memberships) && memberships[0]) {
      setActiveWorkspaceId(memberships[0].workspace.id)
    }
  }, [activeWorkspaceId, memberships])

  useEffect(() => {
    // Load teams whenever workspace changes
    const load = async () => {
      try {
        if (!activeWorkspaceId) {
          setWorkspaceTeams([])
          setActiveTeamId(null)
          return
        }
        const res = await fetch(
          `${import.meta.env.VITE_API_BASE_URL || ''}/api/workspaces/${activeWorkspaceId}/teams`,
          { credentials: 'include' }
        )
        const body = await res.json().catch(() => null)
        if (res.ok && body?.teams) {
          setWorkspaceTeams(body.teams)
          setActiveTeamId(body.teams[0]?.id ?? null)
        } else {
          setWorkspaceTeams([])
          setActiveTeamId(null)
        }
      } catch {
        setWorkspaceTeams([])
        setActiveTeamId(null)
      }
    }
    load()
  }, [activeWorkspaceId])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const connected = params.get('connected')
    if (!connected) return

    const providerParamRaw = params.get('provider')
    const providerParam: OAuthProvider | undefined =
      providerParamRaw === 'google' || providerParamRaw === 'microsoft'
        ? providerParamRaw
        : undefined
    const error = params.get('error') || undefined

    if (connected === 'true') {
      setIntegrationNotice({ kind: 'connected', provider: providerParam })
    } else if (connected === 'false') {
      setIntegrationNotice({
        kind: 'error',
        provider: providerParam,
        message: error
      })
    }

    setSettingsOpen(true)
    setInitialSettingsTab('integrations')

    params.delete('connected')
    params.delete('provider')
    params.delete('error')
    navigate(
      { pathname: location.pathname, search: params.toString() },
      { replace: true }
    )
  }, [location, navigate])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail
      setInitialSettingsTab(detail?.tab ?? 'plan')
      setSettingsOpen(true)
    }
    window.addEventListener('open-plan-settings', handler)
    return () => {
      window.removeEventListener('open-plan-settings', handler)
    }
  }, [])

  return (
    <SecretsProvider>
      <div className="min-h-screen flex flex-col">
        <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
          <div className="flex items-center gap-1 font-bold tracking-tight text-xl text-zinc-900 dark:text-zinc-100">
            <span className="leading-none">Dsentr</span>
            <span
              className="inline-block align-middle"
              style={{ height: '1em' }}
            >
              <DsentrLogo className="w-[1.5em] h-[1.5em]" />
            </span>
          </div>
          {user && (
            <div className="flex items-center gap-3">
              {Array.isArray(memberships) && memberships.length > 0 && (
                <>
                  <select
                    value={activeWorkspaceId ?? ''}
                    onChange={(e) => setActiveWorkspaceId(e.target.value || null)}
                    className="px-2 py-1 text-xs border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
                    title="Active workspace"
                  >
                    {memberships.map((m) => (
                      <option key={m.workspace.id} value={m.workspace.id}>
                        {m.workspace.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={activeTeamId ?? ''}
                    onChange={(e) => setActiveTeamId(e.target.value || null)}
                    className="px-2 py-1 text-xs border rounded bg-white dark:bg-zinc-800 dark:border-zinc-700"
                    title="Active team"
                  >
                    {workspaceTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                    {workspaceTeams.length === 0 && (
                      <option value="">No teams</option>
                    )}
                  </select>
                </>
              )}
              {planLabel ? (
                <span className="rounded-full border border-indigo-500 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:border-indigo-400 dark:text-indigo-300">
                  {planLabel}
                </span>
              ) : null}
              <span className="text-sm text-zinc-600 dark:text-zinc-300 leading-none">
                {user.first_name} {user.last_name}
              </span>
              <NavigateButton
                to="/logout"
                className="px-3 py-2 text-sm leading-none h-9"
              >
                Log out
              </NavigateButton>
              <ThemeToggle />
              <SettingsButton onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          )}
        </header>

        <main className="flex-1 bg-zinc-50 dark:bg-zinc-800">
          <Outlet />
        </main>

        <SettingsModal
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false)
            setInitialSettingsTab(undefined)
          }}
          initialTab={initialSettingsTab}
          tabs={[
            { key: 'plan', label: 'Plan & Billing' },
            { key: 'members', label: 'Members' },
            { key: 'teams', label: 'Teams' },
            { key: 'engine', label: 'Engine' },
            { key: 'logs', label: 'Logs' },
            { key: 'webhooks', label: 'Webhooks' },
            { key: 'options', label: 'Secrets & API Keys' },
            { key: 'integrations', label: 'Integrations' },
            { key: 'workflows', label: 'Workflows' }
          ]}
          renderTab={(key) => {
            if (key === 'plan') return <PlanTab />
            if (key === 'members') return <MembersTab />
            if (key === 'teams') return <TeamsTab />
            if (key === 'engine') return <EngineTab />
            if (key === 'logs') return <LogsTab />
            if (key === 'webhooks') return <WebhooksTab />
            if (key === 'options') return <OptionsTab />
            if (key === 'integrations') {
              return (
                <IntegrationsTab
                  notice={integrationNotice}
                  onDismissNotice={() => setIntegrationNotice(null)}
                />
              )
            }
            if (key === 'workflows') return <WorkflowsTab />
            return <div />
          }}
        />
      </div>
    </SecretsProvider>
  )
}
