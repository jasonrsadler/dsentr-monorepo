import NodeDropdownField from '@/components/ui/input-fields/NodeDropdownField'
import NodeInputField from '@/components/ui/input-fields/NodeInputField'
import NodeSecretDropdown from '@/components/ui/input-fields/NodeSecretDropdown'
import NodeTextAreaField from '@/components/ui/input-fields/NodeTextAreaField'
import NodeCheckBoxField from '@/components/ui/input-fields/NodeCheckboxField'
import KeyValuePair from '@/components/ui/react-flow/KeyValuePair'
import { useState, useEffect } from 'react'

interface HttpRequestActionProps {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  headers?: { key: string; value: string }[]
  queryParams?: { key: string; value: string }[]
  bodyType?: 'raw' | 'json' | 'form'
  body?: string
  formBody?: { key: string; value: string }[]
  timeout?: number
  followRedirects?: boolean
  authType?: 'none' | 'basic' | 'bearer'
  username?: string
  password?: string
  token?: string
  dirty: boolean
  setParams: (params: Partial<HttpRequestActionProps>) => void
  setDirty: (dirty: boolean) => void
}

export default function HttpRequestAction({
  args,
  onChange
}: {
  args: HttpRequestActionProps
  onChange?: (
    args: Partial<HttpRequestActionProps>,
    nodeHasErrors: boolean,
    childDirty: boolean
  ) => void
}) {
  const [params, setParams] = useState(() => ({
    ...args,
    method: args.method || 'GET',
    bodyType: args.bodyType || 'raw',
    headers: args.headers || [],
    queryParams: args.queryParams || [],
    body: args.body || '',
    formBody: args.formBody || [],
    timeout: args.timeout || 30000,
    followRedirects: args.followRedirects ?? true,
    authType: args.authType || 'none'
  }))

  const updateField = (key: keyof HttpRequestActionProps, value: any) => {
    setParams((prev) => ({ ...prev, [key]: value }))
  }

  // Notify parent after params change, outside of render/event to avoid parent updates during child render
  useEffect(() => {
    const errors = hasErrors(params)
    onChange?.(params, Object.keys(errors).length > 0, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const hasErrors = (updatedParams: Partial<HttpRequestActionProps>) => {
    const errs: Record<string, string> = {}
    if (!updatedParams.url?.trim()) errs.urlError = 'URL is required'
    try {
      new URL(updatedParams.url ?? '')
    } catch {
      if (updatedParams.url) errs.urlError = 'Invalid URL'
    }
    if (updatedParams.bodyType === 'json' && updatedParams.body) {
      try {
        JSON.parse(updatedParams.body)
      } catch {
        errs.bodyError = 'Invalid JSON'
      }
    }
    if (
      updatedParams.authType === 'basic' &&
      (!updatedParams.username || !updatedParams.password)
    )
      errs.authError = 'Username and password required'
    if (updatedParams.authType === 'bearer' && !updatedParams.token)
      errs.authError = 'Bearer token required'
    return errs
  }

  const errorClass = 'text-xs text-red-500'

  return (
    <div className="flex flex-col gap-2">
      <NodeInputField
        placeholder="Request URL"
        value={params.url || ''}
        onChange={(val) => updateField('url', val)}
      />
      {hasErrors(params).urlError && (
        <p className={errorClass}>{hasErrors(params).urlError}</p>
      )}

      <NodeDropdownField
        options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']}
        value={params.method}
        onChange={(val) => updateField('method', val)}
      />

      <KeyValuePair
        title="Headers"
        variables={params.headers || []}
        onChange={(updatedVars) => updateField('headers', updatedVars)}
      />

      <KeyValuePair
        title="Query Parameters"
        variables={params.queryParams || []}
        onChange={(updatedVars) => updateField('queryParams', updatedVars)}
      />

      {/* Body input */}
      {params.method !== 'GET' && params.method !== 'DELETE' && (
        <>
          <NodeDropdownField
            options={['raw', 'json', 'form']}
            value={params.bodyType}
            onChange={(val) => updateField('bodyType', val)}
          />
          {params.bodyType === 'raw' || params.bodyType === 'json' ? (
            <NodeTextAreaField
              placeholder={
                params.bodyType === 'json'
                  ? 'JSON Body (e.g. {"key": "value"})'
                  : 'Request Body'
              }
              value={params.body || ''}
              rows={4}
              onChange={(val) => updateField('body', val)}
            />
          ) : (
            <KeyValuePair
              title="Form Body"
              variables={params.formBody || []}
              onChange={(updatedVars) => updateField('formBody', updatedVars)}
            />
          )}
        </>
      )}

      <NodeInputField
        placeholder="Timeout (ms)"
        type="number"
        value={params.timeout?.toString() || ''}
        onChange={(val) => updateField('timeout', Number(val))}
      />

      <NodeCheckBoxField
        checked={params.followRedirects ?? true}
        onChange={(val) => updateField('followRedirects', Boolean(val))}
      >
        Follow Redirects
      </NodeCheckBoxField>

      <NodeDropdownField
        options={['none', 'basic', 'bearer']}
        value={params.authType}
        onChange={(val) => updateField('authType', val)}
      />

      {params.authType === 'basic' && (
        <>
          <NodeInputField
            placeholder="Username"
            value={params.username || ''}
            onChange={(val) => updateField('username', val)}
          />
          <NodeSecretDropdown
            group="http"
            service="basic_auth"
            value={params.password || ''}
            onChange={(val) => updateField('password', val)}
            placeholder="Select HTTP basic password"
          />
        </>
      )}
      {params.authType === 'bearer' && (
        <NodeSecretDropdown
          group="http"
          service="bearer_token"
          value={params.token || ''}
          onChange={(val) => updateField('token', val)}
          placeholder="Select bearer token"
        />
      )}
    </div>
  )
}
