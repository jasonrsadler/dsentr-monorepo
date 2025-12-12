import {
  CreditCard,
  Gauge,
  Users,
  Cpu,
  FileText,
  Webhook,
  KeyRound,
  Shield,
  Puzzle,
  Workflow,
  AlertTriangle
} from 'lucide-react'

export const settingsTabIcons: Record<string, React.ComponentType> = {
  plan: CreditCard,
  usage: Gauge,
  members: Users,
  engine: Cpu,
  logs: FileText,
  webhooks: Webhook,
  options: KeyRound,
  privacy: Shield,
  integrations: Puzzle,
  workflows: Workflow,
  danger: AlertTriangle
}
