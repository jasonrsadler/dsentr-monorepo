import NodeDropdownField from '@/components/UI/InputFields/NodeDropdownField'
import NodeInputField from '@/components/UI/InputFields/NodeInputField'
import NodeTextAreaField from '@/components/UI/InputFields/NodeTextAreaField'
import KeyValuePair from '@/components/UI/ReactFlow/KeyValuePair'
import { useEffect, useMemo, useState } from 'react'

type AuthType = 'none' | 'basic' | 'bearer'

interface WebhookActionProps {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: { key: string; value: string }[]
  queryParams?: { key: string; value: string }[]
  bodyType: 'raw' | 'json' | 'form'
  body: string
  formBody?: { key: string; value: string }[]
  authType?: AuthType
  authUsername?: string
  authPassword?: string
  authToken?: string
  dirty: boolean
  setParams: (params: Partial<WebhookActionProps>) => void
  setDirty: (dirty: boolean) => void
}

interface WebhookErrorActionProps extends Partial<WebhookActionProps> {
  methodError?: string
}

export default function WebhookAction({
  args,
  onChange
}: {
  args: WebhookActionProps
  onChange?: (
    args: Partial<WebhookActionProps>,
    nodeHasErrors: boolean,
    childDirty: boolean
  ) => void
}) {
  const [_, setDirty] = useState(false)
  const [params, setParams] = useState<Partial<WebhookActionProps>>({
    ...args,
    method: args.method || 'POST',
    bodyType: args.bodyType || 'raw',
    headers: args.headers || [],
    queryParams: args.queryParams || [],
    body: args.body || '',
    formBody: args.formBody || [],
    authType: args.authType || 'none'
  })

  const hasErrors = (p: Partial<WebhookActionProps>) => {
    const errors: Partial<WebhookErrorActionProps> = {}

    if (!p.url?.trim()) errors.url = 'Webhook URL is required'
    else {
      try {
        new URL(p.url)
      } catch {
        errors.url = 'Invalid URL'
      }
    }

    if (!p.method) errors.methodError = 'HTTP method is required'

    if (['POST', 'PUT', 'PATCH'].includes(p.method || '')) {
      if (p.bodyType === 'raw' && !p.body?.trim())
        errors.body = 'Request body is required'
      if (p.bodyType === 'json') {
        try {
          JSON.parse(p.body || '')
        } catch {
          errors.body = 'Invalid JSON'
        }
      }
      if (p.bodyType === 'form' && (!p.formBody || p.formBody.length === 0))
        errors.body = 'Form body cannot be empty'
    }

    // Auth validation
    if (p.authType === 'basic') {
      if (!p.authUsername?.trim())
        errors.authUsername = 'Username required for Basic Auth'
      if (!p.authPassword?.trim())
        errors.authPassword = 'Password required for Basic Auth'
    }
    if (p.authType === 'bearer' && !p.authToken?.trim())
      errors.authToken = 'Token required for Bearer Auth'

    return errors
  }

  const webhookErrors = useMemo(() => hasErrors(params), [params])

  useEffect(() => {
    onChange?.(params, Object.keys(hasErrors(params)).length > 0, true)
  }, [params])

  const updateField = (key: keyof WebhookActionProps, value: any) => {
    setDirty(true)
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="Webhook URL"
        value={params.url || ''}
        onChange={(val) => updateField('url', val)}
      />
      {webhookErrors.url && <p className={errorClass}>{webhookErrors.url}</p>}

      <NodeDropdownField
        options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE']}
        value={params.method}
        onChange={(val) => updateField('method', val)}
      />

      <KeyValuePair
        title="Headers"
        variables={params.headers || []}
        onChange={(updatedVars, nodeHasErrors, childDirty) => {
          setParams((prev) => ({ ...prev, headers: updatedVars }))
          setDirty((prev) => prev || childDirty)
          onChange?.(
            { ...params, headers: updatedVars },
            nodeHasErrors,
            childDirty
          )
        }}
      />

      <KeyValuePair
        title="Query Parameters"
        variables={params.queryParams || []}
        onChange={(updatedVars, nodeHasErrors, childDirty) => {
          setParams((prev) => ({ ...prev, queryParams: updatedVars }))
          setDirty((prev) => prev || childDirty)
          onChange?.(
            { ...params, queryParams: updatedVars },
            nodeHasErrors,
            childDirty
          )
        }}
      />

      <NodeDropdownField
        options={['raw', 'json', 'form']}
        value={params.bodyType}
        onChange={(val) => updateField('bodyType', val)}
      />

      {['raw', 'json'].includes(params.bodyType || '') && (
        <NodeTextAreaField
          placeholder={
            params.bodyType === 'raw'
              ? 'Request Body'
              : 'JSON Body (e.g. {"key":"value"})'
          }
          value={params.body || ''}
          rows={6}
          onChange={(val) => updateField('body', val)}
        />
      )}

      {params.bodyType === 'form' && (
        <KeyValuePair
          title="Form Body"
          variables={params.formBody || []}
          onChange={(updatedVars, nodeHasErrors, childDirty) => {
            setParams((prev) => ({ ...prev, formBody: updatedVars }))
            setDirty((prev) => prev || childDirty)
            onChange?.(
              { ...params, formBody: updatedVars },
              nodeHasErrors,
              childDirty
            )
          }}
        />
      )}
      {webhookErrors.body && <p className={errorClass}>{webhookErrors.body}</p>}

      <p className="text-xs text-zinc-500">Authentication</p>
      <NodeDropdownField
        options={['none', 'basic', 'bearer']}
        value={params.authType}
        onChange={(val) => updateField('authType', val)}
      />

      {params.authType === 'basic' && (
        <>
          <NodeInputField
            placeholder="Username"
            value={params.authUsername || ''}
            onChange={(val) => updateField('authUsername', val)}
          />
          {webhookErrors.authUsername && (
            <p className={errorClass}>{webhookErrors.authUsername}</p>
          )}
          <NodeInputField
            placeholder="Password"
            type="password"
            value={params.authPassword || ''}
            onChange={(val) => updateField('authPassword', val)}
          />
          {webhookErrors.authPassword && (
            <p className={errorClass}>{webhookErrors.authPassword}</p>
          )}
        </>
      )}

      {params.authType === 'bearer' && (
        <>
          <NodeInputField
            placeholder="Token"
            type="password"
            value={params.authToken || ''}
            onChange={(val) => updateField('authToken', val)}
          />
          {webhookErrors.authToken && (
            <p className={errorClass}>{webhookErrors.authToken}</p>
          )}
        </>
      )}
    </div>
  )
}
