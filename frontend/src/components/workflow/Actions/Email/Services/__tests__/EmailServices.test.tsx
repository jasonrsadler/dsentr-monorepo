import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'

import AmazonSESAction from '../AmazonSESAction'
import MailGunAction from '../MailGunAction'
import SendGridAction from '../SendGridAction'
import SMTPAction from '../SMTPAction'

vi.mock('@/components/UI/InputFields/NodeInputField', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder, type }: any) => (
    <input
      placeholder={placeholder}
      value={value ?? ''}
      type={type ?? 'text'}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

vi.mock('@/components/UI/InputFields/NodeTextAreaField', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder, rows }: any) => (
    <textarea
      placeholder={placeholder}
      value={value ?? ''}
      rows={rows}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}))

vi.mock('@/components/UI/InputFields/NodeSecretDropdown', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder }: any) => (
    <select
      aria-label={placeholder ?? 'secret-dropdown'}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Select</option>
      <option value="token">token</option>
    </select>
  )
}))

vi.mock('../ServiceDropDowns/SESRegionDropdown', () => ({
  __esModule: true,
  default: ({ value, onChange }: any) => (
    <select
      aria-label="ses-region"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="us-east-1">us-east-1</option>
      <option value="us-west-2">us-west-2</option>
    </select>
  )
}))

vi.mock('../ServiceDropDowns/SESVersionDropdown', () => ({
  __esModule: true,
  default: ({ value, onChange }: any) => (
    <select
      aria-label="ses-version"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="2010-12-01">2010-12-01</option>
      <option value="2023-01-01">2023-01-01</option>
    </select>
  )
}))

vi.mock('../ServiceDropDowns/MailgunRegionDropdown', () => ({
  __esModule: true,
  default: ({ value, onChange }: any) => (
    <select
      aria-label="mailgun-region"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="US (api.mailgun.net)">US (api.mailgun.net)</option>
      <option value="EU (api.eu.mailgun.net)">EU (api.eu.mailgun.net)</option>
    </select>
  )
}))

vi.mock('@/components/UI/ReactFlow/KeyValuePair', () => ({
  __esModule: true,
  default: ({ title, onChange }: any) => (
    <button
      type="button"
      onClick={() => onChange([{ key: 'name', value: 'Alice' }], false)}
    >
      {title}
    </button>
  )
}))

const updateNodeData = vi.fn()

const workflowState = {
  canEdit: true,
  updateNodeData
}

const mockActionParams = vi.fn()

vi.mock('@/stores/workflowSelectors', () => ({
  useActionParams: (nodeId: string) => mockActionParams(nodeId)
}))

vi.mock('@/stores/workflowStore', () => {
  const useWorkflowStore = (
    selector: (state: typeof workflowState) => unknown
  ) => selector(workflowState)
  useWorkflowStore.setState = (partial: any) => {
    if (typeof partial === 'function') {
      Object.assign(workflowState, partial(workflowState))
    } else {
      Object.assign(workflowState, partial)
    }
  }
  useWorkflowStore.getState = () => workflowState
  return { useWorkflowStore }
})

const paramsByNode: Record<string, Record<string, unknown>> = {}

beforeEach(() => {
  updateNodeData.mockClear()
  mockActionParams.mockImplementation((nodeId: string) => paramsByNode[nodeId])
  Object.keys(paramsByNode).forEach((key) => delete paramsByNode[key])
})

describe('AmazonSESAction', () => {
  it('dispatches field updates and validation flags', async () => {
    paramsByNode['ses-node'] = {
      awsAccessKey: 'AKIA-123',
      awsSecretKey: 'secret-key',
      awsRegion: 'us-east-1',
      sesVersion: '2010-12-01',
      fromEmail: 'sender@example.com',
      toEmail: 'recipient@example.com',
      template: 'marketing-template',
      templateVariables: [],
      dirty: false
    }

    render(<AmazonSESAction nodeId="ses-node" />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith('ses-node', {
        hasValidationErrors: false
      })
    })

    updateNodeData.mockClear()

    fireEvent.change(screen.getByPlaceholderText('AWS Access Key ID'), {
      target: { value: 'AKIA-456' }
    })

    expect(updateNodeData).toHaveBeenCalledWith(
      'ses-node',
      expect.objectContaining({
        params: expect.objectContaining({ awsAccessKey: 'AKIA-456' }),
        dirty: true
      })
    )

    updateNodeData.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Template Variables' }))

    expect(updateNodeData).toHaveBeenCalledWith(
      'ses-node',
      expect.objectContaining({
        params: expect.objectContaining({
          templateVariables: [{ key: 'name', value: 'Alice' }]
        }),
        dirty: true
      })
    )
  })
})

describe('MailGunAction', () => {
  it('emits updates for inputs and variables', async () => {
    paramsByNode['mailgun-node'] = {
      domain: 'mg.example.com',
      apiKey: 'api-key',
      region: 'US (api.mailgun.net)',
      from: 'sender@example.com',
      to: 'recipient@example.com',
      template: 'mg-template',
      variables: [],
      dirty: false
    }

    render(<MailGunAction nodeId="mailgun-node" />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith('mailgun-node', {
        hasValidationErrors: false
      })
    })

    updateNodeData.mockClear()

    fireEvent.change(
      screen.getByPlaceholderText('Domain (e.g. mg.example.com)'),
      { target: { value: 'mg.updated.com' } }
    )

    expect(updateNodeData).toHaveBeenCalledWith(
      'mailgun-node',
      expect.objectContaining({
        params: expect.objectContaining({ domain: 'mg.updated.com' }),
        dirty: true
      })
    )

    updateNodeData.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Template Variables' }))

    expect(updateNodeData).toHaveBeenCalledWith(
      'mailgun-node',
      expect.objectContaining({
        params: expect.objectContaining({
          variables: [{ key: 'name', value: 'Alice' }]
        }),
        dirty: true
      })
    )
  })
})

describe('SendGridAction', () => {
  it('updates params for inputs and substitutions', async () => {
    paramsByNode['sendgrid-node'] = {
      apiKey: 'sg-key',
      from: 'sender@example.com',
      to: 'recipient@example.com',
      templateId: 'tmpl-1',
      substitutions: [],
      dirty: false
    }

    render(<SendGridAction nodeId="sendgrid-node" />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith('sendgrid-node', {
        hasValidationErrors: false
      })
    })

    updateNodeData.mockClear()

    fireEvent.change(screen.getByPlaceholderText('From Email'), {
      target: { value: 'noreply@example.com' }
    })

    expect(updateNodeData).toHaveBeenCalledWith(
      'sendgrid-node',
      expect.objectContaining({
        params: expect.objectContaining({ from: 'noreply@example.com' }),
        dirty: true
      })
    )

    updateNodeData.mockClear()

    fireEvent.click(
      screen.getByRole('button', { name: 'Template Substitutions' })
    )

    expect(updateNodeData).toHaveBeenCalledWith(
      'sendgrid-node',
      expect.objectContaining({
        params: expect.objectContaining({
          substitutions: [{ key: 'name', value: 'Alice' }]
        }),
        dirty: true
      })
    )
  })
})

describe('SMTPAction', () => {
  it('dispatches updates for SMTP fields and validation flag', async () => {
    paramsByNode['smtp-node'] = {
      smtpHost: 'smtp.initial.com',
      smtpPort: 587,
      smtpUser: 'user',
      smtpPassword: 'secret',
      smtpTlsMode: 'starttls',
      from: 'sender@example.com',
      to: 'recipient@example.com',
      subject: 'Subject',
      body: 'Body',
      dirty: false
    }

    render(<SMTPAction nodeId="smtp-node" />)

    await waitFor(() => {
      expect(updateNodeData).toHaveBeenCalledWith('smtp-node', {
        hasValidationErrors: false
      })
    })

    updateNodeData.mockClear()

    fireEvent.change(screen.getByPlaceholderText('SMTP Host'), {
      target: { value: 'smtp.updated.com' }
    })

    expect(updateNodeData).toHaveBeenCalledWith(
      'smtp-node',
      expect.objectContaining({
        params: expect.objectContaining({ smtpHost: 'smtp.updated.com' }),
        dirty: true
      })
    )

    updateNodeData.mockClear()

    fireEvent.click(
      screen.getByLabelText(/Do not use TLS \(insecure - only if required\)/)
    )

    expect(updateNodeData).toHaveBeenCalledWith(
      'smtp-node',
      expect.objectContaining({
        params: expect.objectContaining({
          smtpTlsMode: 'none',
          smtpTls: false,
          smtpPort: 25
        }),
        dirty: true
      })
    )
  })
})
