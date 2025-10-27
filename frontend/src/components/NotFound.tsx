// src/NotFound.tsx
import { Link } from 'react-router-dom'
import { NavigateButton } from './ui/buttons/NavigateButton'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <h1 className="text-4xl font-bold mb-2">404</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400 mb-6">
        The page you're looking for doesn't exist.
      </p>

      <div className="mb-6">
        <p className="text-md text-zinc-500 dark:text-zinc-300">
          But don't worry! Here are some helpful links to get you back on track:
        </p>

        <div className="mt-4 space-y-2">
          <Link
            to="/"
            className="block text-lg text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-600"
          >
            Go back to the Home page
          </Link>
          <Link
            to="/about"
            className="block text-lg text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-600"
          >
            Learn more about Dsentr
          </Link>
          <Link
            to="/how-it-works"
            className="block text-lg text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-600"
          >
            Discover how Dsentr works
          </Link>
        </div>
      </div>
      <NavigateButton to="/">Go home</NavigateButton>
    </div>
  )
}
