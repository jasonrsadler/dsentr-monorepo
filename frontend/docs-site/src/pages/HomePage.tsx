import { Link } from "react-router-dom";
import { navItems } from "../content/navigation";

export function HomePage() {
  return (
    <>
      <section className="hero">
        <h1>Welcome to the dsentr documentation</h1>
        <p>
          Explore product guides that teach customers how to onboard, navigate the
          dashboard, administer workspaces, and build automations with confidence.
        </p>
        <div className="cta-grid" role="list">
          {navItems
            .filter((item) => item.to !== "/")
            .map((item) => (
              <Link key={item.to} className="cta-tile" to={item.to} role="listitem">
                <span>{item.label}</span>
                <p style={{ margin: "0.35rem 0 0", fontWeight: 400, fontSize: "0.95rem" }}>
                  {item.description}
                </p>
              </Link>
            ))}
        </div>
      </section>
      <article className="page-card">
        <h2>How this site is organized</h2>
        <p>
          dsentr is a modular automation platform with a visual workflow designer and
          shared workspace management. Each section of the documentation mirrors the
          key areas of the product so you can quickly find relevant guidance.
        </p>
        <div className="content-section">
          <h3>Who should use these docs?</h3>
          <p>
            These guides are written for end users—workspace owners, admins, and members
            responsible for building and maintaining automations. They avoid code-level
            explanations and focus on real product behavior.
          </p>
        </div>
        <div className="content-section">
          <h3>What to expect</h3>
          <ul>
            <li>Step-by-step onboarding instructions and invite handling tips.</li>
            <li>Annotated screenshots of dashboard areas and navigation controls.</li>
            <li>Plan-specific callouts so Solo and Workspace users know their limits.</li>
            <li>Detailed workflow designer coverage for building, testing, and running flows.</li>
          </ul>
        </div>
      </article>
    </>
  );
}
