export type FormatterOperation =
  | 'string.trim'
  | 'string.lowercase'
  | 'string.uppercase'
  | 'string.replace'
  | 'string.split'
  | 'string.substring'
  | 'number.add'
  | 'number.subtract'
  | 'number.multiply'
  | 'number.divide'
  | 'number.round'
  | 'type.to_number'
  | 'json.pick'
  | 'json.flatten'
  | 'json.merge'
  | 'json.to_array'
  | 'json.to_object'
  | 'date.parse'
  | 'date.format'
  | 'date.adjust'
  | 'date.extract'
  | 'bool.to_boolean'
  | 'bool.is_empty'
  | 'type.to_string'

export interface FormatterConfig {
  operation: string
  input: string
  fields: Record<string, any>
  output_key: string
}

export type FormatterValidationResult = {
  hasErrors: boolean
  messages: string[]
}

const NUMERIC_FIELDS = new Set([
  'index',
  'start',
  'length',
  'value',
  'decimal_places',
  'days',
  'hours',
  'minutes'
])

const BOOLEAN_FIELDS = new Set(['trim_items'])

const DEFAULT_FIELDS: Partial<Record<FormatterOperation, Record<string, any>>> =
  {
    'json.to_array': { trim_items: true },
    'date.parse': { format: 'rfc3339' },
    'date.format': { output_format: 'rfc3339' },
    'date.extract': { component: 'year', timezone: 'UTC' }
  }

const ALLOWED_FIELDS: Record<FormatterOperation, string[]> = {
  'string.trim': [],
  'string.lowercase': [],
  'string.uppercase': [],
  'string.replace': ['search_for', 'replace_with'],
  'string.split': ['delimiter', 'index'],
  'string.substring': ['start', 'length'],
  'number.add': ['value'],
  'number.subtract': ['value'],
  'number.multiply': ['value'],
  'number.divide': ['value'],
  'number.round': ['decimal_places'],
  'type.to_number': [],
  'json.pick': ['json_path'],
  'json.flatten': [],
  'json.merge': ['input_two'],
  'json.to_array': ['delimiter', 'trim_items'],
  'json.to_object': ['key_name'],
  'date.parse': ['format'],
  'date.format': ['output_format'],
  'date.adjust': ['days', 'hours', 'minutes'],
  'date.extract': ['component', 'timezone'],
  'bool.to_boolean': [],
  'bool.is_empty': [],
  'type.to_string': []
}

export const OPERATION_GROUPS: {
  label: string
  options: { label: string; value: FormatterOperation }[]
}[] = [
  {
    label: 'Strings',
    options: [
      { label: 'Trim', value: 'string.trim' },
      { label: 'Lowercase', value: 'string.lowercase' },
      { label: 'Uppercase', value: 'string.uppercase' },
      { label: 'Replace', value: 'string.replace' },
      { label: 'Split', value: 'string.split' },
      { label: 'Substring', value: 'string.substring' }
    ]
  },
  {
    label: 'Numbers',
    options: [
      { label: 'Add', value: 'number.add' },
      { label: 'Subtract', value: 'number.subtract' },
      { label: 'Multiply', value: 'number.multiply' },
      { label: 'Divide', value: 'number.divide' },
      { label: 'Round', value: 'number.round' },
      { label: 'Convert to Number', value: 'type.to_number' }
    ]
  },
  {
    label: 'JSON',
    options: [
      { label: 'Pick Field', value: 'json.pick' },
      { label: 'Flatten', value: 'json.flatten' },
      { label: 'Merge', value: 'json.merge' },
      { label: 'Convert to Object', value: 'json.to_object' },
      { label: 'Convert to Array', value: 'json.to_array' }
    ]
  },
  {
    label: 'Dates',
    options: [
      { label: 'Parse', value: 'date.parse' },
      { label: 'Format', value: 'date.format' },
      { label: 'Add/Subtract Time', value: 'date.adjust' },
      { label: 'Extract Component', value: 'date.extract' }
    ]
  },
  {
    label: 'Booleans',
    options: [
      { label: 'To Boolean', value: 'bool.to_boolean' },
      { label: 'Is Empty', value: 'bool.is_empty' }
    ]
  },
  {
    label: 'Type Conversion',
    options: [{ label: 'Convert to String', value: 'type.to_string' }]
  }
]

export const DATE_FORMAT_OPTIONS = [
  { label: 'ISO 8601 / RFC3339', value: 'rfc3339' },
  { label: 'RFC2822', value: 'rfc2822' },
  { label: 'Date (YYYY-MM-DD)', value: 'date_only' },
  { label: 'DateTime (YYYY-MM-DD HH:mm:ss)', value: 'datetime' },
  { label: 'US Short (MM/DD/YYYY)', value: 'us_short' },
  { label: 'Unix Timestamp (seconds)', value: 'unix_seconds' },
  { label: 'Unix Timestamp (ms)', value: 'unix_milliseconds' }
] as const

export const DATE_COMPONENT_OPTIONS = [
  { label: 'Year', value: 'year' },
  { label: 'Month', value: 'month' },
  { label: 'Day', value: 'day' },
  { label: 'Hour', value: 'hour' },
  { label: 'Minute', value: 'minute' },
  { label: 'Second', value: 'second' },
  { label: 'Weekday', value: 'weekday' }
] as const

export const TIMEZONE_OPTIONS = [
  { label: 'UTC', value: 'UTC' },
  { label: 'America/New_York', value: 'America/New_York' },
  { label: 'America/Los_Angeles', value: 'America/Los_Angeles' },
  { label: 'Europe/London', value: 'Europe/London' },
  { label: 'Europe/Berlin', value: 'Europe/Berlin' },
  { label: 'Asia/Tokyo', value: 'Asia/Tokyo' },
  { label: 'Asia/Singapore', value: 'Asia/Singapore' },
  { label: 'Australia/Sydney', value: 'Australia/Sydney' }
] as const

const parseNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    return value
  }
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return undefined
  return parsed
}

const sanitizeFieldsForOperation = (
  operation: FormatterOperation | string,
  fields: Record<string, any>
): Record<string, any> => {
  const allowedKeys = ALLOWED_FIELDS[operation as FormatterOperation] ?? []
  const defaults = DEFAULT_FIELDS[operation as FormatterOperation] ?? {}
  const out: Record<string, any> = {}
  allowedKeys.forEach((key) => {
    const raw = fields?.[key]
    if (NUMERIC_FIELDS.has(key)) {
      const parsed = parseNumber(raw)
      if (parsed !== undefined) {
        out[key] = parsed
      }
      return
    }
    if (BOOLEAN_FIELDS.has(key)) {
      out[key] = Boolean(raw ?? defaults[key] ?? false)
      return
    }
    const trimmed =
      typeof raw === 'string'
        ? raw.trim()
        : typeof raw === 'number' || typeof raw === 'boolean'
          ? raw
          : undefined
    if (trimmed !== undefined && trimmed !== '') {
      out[key] = trimmed
      return
    }
    if (defaults && key in defaults) {
      out[key] = defaults[key]
    }
  })

  return Object.keys(out).length === 0 ? { ...defaults } : out
}

export const normalizeFormatterConfig = (
  config?: FormatterConfig
): FormatterConfig => {
  const operation = (config?.operation ?? '').trim()
  const input = typeof config?.input === 'string' ? config.input : ''
  const output_key =
    typeof config?.output_key === 'string' ? config.output_key.trim() : ''
  const fields = sanitizeFieldsForOperation(
    operation,
    (config?.fields as Record<string, any>) ?? {}
  )

  return {
    operation,
    input,
    fields,
    output_key
  }
}

export const validateOutputKey = (key: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)

const hasNumericValue = (value: any): boolean =>
  typeof value === 'number' && Number.isFinite(value)

export const validateFormatterConfig = (
  config: FormatterConfig
): FormatterValidationResult => {
  const messages: string[] = []
  const operation = (config.operation ?? '').trim()
  const input = (config.input ?? '').trim()
  const outputKey = (config.output_key ?? '').trim()
  const fields = config.fields ?? {}

  if (!operation) {
    messages.push('Select an operation.')
  }

  if (!outputKey) {
    messages.push('Output key is required.')
  } else if (!validateOutputKey(outputKey)) {
    messages.push(
      'Output key must be a valid identifier (letters, numbers, underscores).'
    )
  }

  if (operation) {
    if (!input) {
      messages.push('Input value is required.')
    }
    switch (operation as FormatterOperation) {
      case 'string.replace': {
        if (!fields.search_for) {
          messages.push('Provide text to search for.')
        }
        if (!fields.replace_with && fields.replace_with !== '') {
          messages.push('Provide replacement text.')
        }
        break
      }
      case 'string.split': {
        if (!fields.delimiter) {
          messages.push('Delimiter is required.')
        }
        if (!hasNumericValue(fields.index) || (fields.index as number) < 0) {
          messages.push('Split index must be zero or greater.')
        }
        break
      }
      case 'string.substring': {
        if (!hasNumericValue(fields.start) || (fields.start as number) < 0) {
          messages.push('Start index must be zero or greater.')
        }
        if (!hasNumericValue(fields.length) || (fields.length as number) < 0) {
          messages.push('Length must be zero or greater.')
        }
        break
      }
      case 'number.add':
      case 'number.subtract':
      case 'number.multiply':
      case 'number.divide':
        if (!hasNumericValue(fields.value)) {
          messages.push('Provide a numeric value.')
        }
        break
      case 'number.round':
        if (!hasNumericValue(fields.decimal_places)) {
          messages.push('Decimal places must be numeric.')
        }
        break
      case 'json.pick':
        if (!fields.json_path || !String(fields.json_path).trim()) {
          messages.push('JSON path is required.')
        }
        break
      case 'json.merge':
        if (!fields.input_two || !String(fields.input_two).trim()) {
          messages.push('Provide the second JSON input.')
        }
        break
      case 'json.to_array':
        if (!fields.delimiter || !String(fields.delimiter).trim()) {
          messages.push('Delimiter is required.')
        }
        break
      case 'json.to_object':
        if (!fields.key_name || !String(fields.key_name).trim()) {
          messages.push('Key name is required.')
        }
        break
      case 'date.parse':
        if (!fields.format || !String(fields.format).trim()) {
          messages.push('Select an input format.')
        }
        break
      case 'date.format':
        if (!fields.output_format || !String(fields.output_format).trim()) {
          messages.push('Select an output format.')
        }
        break
      case 'date.adjust': {
        const hasAny =
          hasNumericValue(fields.days) ||
          hasNumericValue(fields.hours) ||
          hasNumericValue(fields.minutes)
        if (!hasAny) {
          messages.push(
            'Add at least one time offset (days, hours, or minutes).'
          )
        }
        break
      }
      case 'date.extract': {
        if (!fields.component) {
          messages.push('Select a date component to extract.')
        }
        if (!fields.timezone) {
          messages.push('Select a timezone.')
        }
        break
      }
      default:
        break
    }
  }

  return { hasErrors: messages.length > 0, messages }
}

export const createEmptyFormatterConfig = (): FormatterConfig =>
  normalizeFormatterConfig({
    operation: '',
    input: '',
    output_key: '',
    fields: {}
  })
