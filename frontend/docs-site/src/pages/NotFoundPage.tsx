import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <article className="page-card">
      <h2>Page not found</h2>
      <p>
        The page you requested is not part of the dsentr documentation yet.
        Return to the overview to browse available guides.
      </p>
      <Link className="cta-tile" to="/">
        Back to overview
      </Link>
    </article>
  )
}
