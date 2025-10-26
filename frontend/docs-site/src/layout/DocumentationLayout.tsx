import { Outlet } from 'react-router-dom'
import { SidebarNav } from '../components/SidebarNav'

export function DocumentationLayout() {
  return (
    <div className="layout">
      <SidebarNav />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
