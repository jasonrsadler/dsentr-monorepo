declare module 'jsdom' {
  export interface DOMWindow extends Window {}

  export interface VirtualConsole {
    sendTo(console: Console): void
  }

  export interface ConstructorOptions {
    url?: string
    referrer?: string
    contentType?: string
    storageQuota?: number
    pretendToBeVisual?: boolean
    runScripts?: 'dangerously' | 'outside-only'
    resources?: unknown
    virtualConsole?: VirtualConsole | undefined
  }

  export class JSDOM {
    constructor(html?: string | null, options?: ConstructorOptions)
    window: DOMWindow & typeof globalThis
    serialize(): string
  }
}

export {}
