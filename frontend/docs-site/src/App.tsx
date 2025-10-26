import { Route, Routes } from 'react-router-dom'
import { DocumentationLayout } from './layout/DocumentationLayout'
import { HomePage } from './pages/HomePage'
import { GettingStartedPage } from './pages/GettingStartedPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { WorkflowDesignerPage } from './pages/WorkflowDesignerPage'
import { NotFoundPage } from './pages/NotFoundPage'

export default function App() {
  return (
    <Routes>
      <Route element={<DocumentationLayout />}>
        <Route index element={<HomePage />} />
        <Route path="getting-started" element={<GettingStartedPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="workflow-designer" element={<WorkflowDesignerPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
