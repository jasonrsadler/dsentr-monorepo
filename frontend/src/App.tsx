import { useEffect, useRef } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useAuth } from '@/stores/auth'
import PublicLayout from '@/layouts/PublicLayout'
import DashboardLayout from '@/layouts/DashboardLayout'
import Home from '@/Home'
import About from '@/About'
import HowItWorks from '@/HowItWorks'
import GetStarted from '@/GetStarted'
import Signup from '@/Signup'
import CheckEmail from '@/CheckEmail'
import VerifyEmail from '@/VerifyEmail'
import Login from '@/Login'
import ProtectedRoute from '@/components/ProtectedRoute'
import LogoutHandler from '@/Logout'
import ForgotPassword from '@/ForgotPassword'
import ResetPassword from './ResetPassword'
import NotFound from '@/components/NotFound'
import Dashboard from './layouts/DashboardLayouts/Dashboard'
import WorkspaceOnboarding from './WorkspaceOnboarding'
import ConfirmAccountDeletion from '@/ConfirmAccountDeletion'

export default function App() {
  const { isLoading, checkAuth } = useAuth()
  const hasCheckedAuth = useRef(false)

  useEffect(() => {
    if (!hasCheckedAuth.current) {
      hasCheckedAuth.current = true
      checkAuth()
    }
  }, [checkAuth])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-zinc-600 dark:text-zinc-300">Loading...</div>
      </div>
    )
  }

  return (
    <Routes>
      {/* Public pages use PublicLayout */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/get-started" element={<GetStarted />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/check-email" element={<CheckEmail />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/login" element={<Login />} />
        <Route path="/logout" element={<LogoutHandler />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password/:token" element={<ResetPassword />} />
        <Route
          path="/delete-account/:token"
          element={<ConfirmAccountDeletion />}
        />
      </Route>

      <Route
        path="/onboarding"
        element={
          <ProtectedRoute>
            <WorkspaceOnboarding />
          </ProtectedRoute>
        }
      />

      {/* Dashboard pages use DashboardLayout */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
