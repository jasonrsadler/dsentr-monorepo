// src/layouts/DashboardLayout.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ThemeToggle } from '@/components/ThemeToggle'
import { NavigateButton } from '@/components/ui/buttons/NavigateButton'
import { selectCurrentWorkspace, useAuth } from '@/stores/auth'
import SettingsButton from '@/components/settings/SettingsButton'
import SettingsModal from '@/components/settings/SettingsModal'
import WorkflowsTab from '@/components/settings/tabs/WorkflowsTab'
import EngineTab from '@/components/settings/tabs/EngineTab'
import LogsTab from '@/components/settings/tabs/LogsTab'
import WebhooksTab from '@/components/settings/tabs/WebhooksTab'
import OptionsTab from '@/components/settings/tabs/OptionsTab'
import IntegrationsTab, {
  IntegrationNotice
} from '@/components/settings/tabs/IntegrationsTab'
import PlanTab from '@/components/settings/tabs/PlanTab'
import MembersTab from '@/components/settings/tabs/MembersTab'
import DangerZoneTab from '@/components/settings/tabs/DangerZoneTab'
import { DsentrLogo } from '@/components/DsentrLogo'
import { SecretsProvider } from '@/contexts/SecretsContext'
import { OAuthProvider } from '@/lib/oauthApi'
import ProfileButton from '@/components/profile/ProfileButton'
import ProfileModal from '@/components/profile/ProfileModal'

export default function DashboardLayout() {
  const user = useAuth((state) => state.user)
  const memberships = useAuth((state) => state.memberships)
  const currentWorkspaceId = useAuth((state) => state.currentWorkspaceId)
  const currentWorkspace = useAuth(selectCurrentWorkspace)
  const setCurrentWorkspaceId = useAuth((state) => state.setCurrentWorkspaceId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [initialSettingsTab, setInitialSettingsTab] = useState<
    string | undefined
  >(undefined)
  const [integrationNotice, setIntegrationNotice] =
    useState<IntegrationNotice | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  // Preferences removed

  const hasWorkspaces = memberships.length > 0
  const hasMultipleWorkspaces = memberships.length > 1
  const previousSearchRef = useRef<string | null>(null)
  const hasSyncedQueryRef = useRef(false)

  const currentWorkspaceName = useMemo(() => {
    if (!currentWorkspace) return ''
    const name = currentWorkspace.workspace.name?.trim()
    return name || 'Unnamed workspace'
  }, [currentWorkspace])

  useEffect(() => {
    if (memberships.length === 1) {
      const soleId = memberships[0]?.workspace.id
      if (soleId && soleId !== currentWorkspaceId) {
        setCurrentWorkspaceId(soleId)
      }
    }
  }, [memberships, currentWorkspaceId, setCurrentWorkspaceId])

  useEffect(() => {
    if (previousSearchRef.current === location.search) {
      return
    }
    previousSearchRef.current = location.search
    const params = new URLSearchParams(location.search)
    const workspaceFromQuery = params.get('workspace')
    if (!workspaceFromQuery) return
    if (!memberships.some((m) => m.workspace.id === workspaceFromQuery)) return
    if (workspaceFromQuery !== currentWorkspaceId) {
      setCurrentWorkspaceId(workspaceFromQuery)
    }
  }, [currentWorkspaceId, location.search, memberships, setCurrentWorkspaceId])

  const syncWorkspaceParam = useCallback(
    (workspaceId: string | null, replace = false) => {
      const params = new URLSearchParams(location.search)
      const existing = params.get('workspace')
      if (workspaceId) {
        if (existing === workspaceId) return
        params.set('workspace', workspaceId)
      } else {
        if (!existing) return
        params.delete('workspace')
      }
      navigate(
        { pathname: location.pathname, search: params.toString() },
        { replace }
      )
    },
    [location.pathname, location.search, navigate]
  )

  useEffect(() => {
    // Open plan settings when returning from Stripe Checkout
    const params = new URLSearchParams(location.search)
    const billing = params.get('billing')
    if (billing === 'success' || billing === 'cancel') {
      setInitialSettingsTab('plan')
      setSettingsOpen(true)
      // Do not clear params here; allow PlanTab to process confirmation state.
    }
  }, [location.search])

  useEffect(() => {
    const id = currentWorkspace?.workspace.id ?? null
    const params = new URLSearchParams(location.search)
    const existing = params.get('workspace')
    if (!hasSyncedQueryRef.current) {
      // Initial mount: respect an existing query param that differs;
      // the URL->store effect will reconcile selection. After the first run,
      // always sync the query param with the current selection.
      hasSyncedQueryRef.current = true
      if (existing && existing !== id) return
    }
    syncWorkspaceParam(id, true)
  }, [currentWorkspace, syncWorkspaceParam, location.search])

  const handleWorkspaceChange = useCallback(
    (workspaceId: string) => {
      if (!workspaceId || workspaceId === currentWorkspaceId) return
      setCurrentWorkspaceId(workspaceId)
    },
    [currentWorkspaceId, setCurrentWorkspaceId]
  )

  const planLabel = useMemo(() => {
    const planSource = currentWorkspace?.workspace.plan ?? user?.plan
    if (!planSource) return null
    const normalized = planSource.trim()
    if (!normalized) return null
    return normalized.charAt(0).toUpperCase() + normalized.slice(1)
  }, [currentWorkspace?.workspace.plan, user?.plan])

  const settingsTabs = useMemo(
    () => [
      { key: 'plan', label: 'Plan & Billing' },
      { key: 'members', label: 'Members' },
      { key: 'engine', label: 'Engine' },
      { key: 'logs', label: 'Logs' },
      { key: 'webhooks', label: 'Webhooks' },
      { key: 'options', label: 'Secrets & API Keys' },
      { key: 'integrations', label: 'Integrations' },
      { key: 'workflows', label: 'Workflows' },
      { key: 'danger', label: 'Danger Zone' }
    ],
    []
  )

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const connected = params.get('connected')
    if (!connected) return

    const providerParamRaw = params.get('provider')
    const providerParam: OAuthProvider | undefined =
      providerParamRaw === 'google' ||
      providerParamRaw === 'microsoft' ||
      providerParamRaw === 'slack'
        ? (providerParamRaw as OAuthProvider)
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
              {hasWorkspaces ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Active workspace
                  </span>
                  {hasMultipleWorkspaces ? (
                    <select
                      aria-label="Workspace switcher"
                      value={currentWorkspace?.workspace.id ?? ''}
                      onChange={(event) =>
                        handleWorkspaceChange(event.target.value)
                      }
                      className="px-2 py-1 border rounded-md bg-white text-sm dark:bg-zinc-800 dark:border-zinc-700"
                    >
                      {memberships.map((membership) => (
                        <option
                          key={membership.workspace.id}
                          value={membership.workspace.id}
                        >
                          {membership.workspace.name || 'Unnamed workspace'}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sm text-zinc-700 dark:text-zinc-200">
                      {currentWorkspaceName}
                    </span>
                  )}
                </div>
              ) : null}
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
              <ProfileButton onOpenProfile={() => setProfileOpen(true)} />
              <SettingsButton onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          )}
        </header>

        <main className="flex-1 bg-zinc-50 dark:bg-zinc-800">
          <Outlet />
        </main>

        <ProfileModal
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
        />
        <SettingsModal
          open={settingsOpen}
          onClose={() => {
            setSettingsOpen(false)
            setInitialSettingsTab(undefined)
          }}
          initialTab={initialSettingsTab}
          tabs={settingsTabs}
          renderTab={(key) => {
            if (key === 'plan') return <PlanTab />
            if (key === 'members') return <MembersTab />
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
            if (key === 'danger') return <DangerZoneTab />
            return <div />
          }}
        />
      </div>
    </SecretsProvider>
  )
}
