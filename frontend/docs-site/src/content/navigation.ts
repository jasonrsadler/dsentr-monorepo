export type NavItem = {
  to: string;
  label: string;
  description: string;
};

export const navItems: NavItem[] = [
  {
    to: "/",
    label: "Overview",
    description: "Start here to understand dsentr at a glance"
  },
  {
    to: "/getting-started",
    label: "Getting Started",
    description: "Create an account, verify it, and onboard your workspace"
  },
  {
    to: "/dashboard",
    label: "Dashboard",
    description: "See how navigation, notices, and workflow context fit together"
  },
  {
    to: "/settings",
    label: "Settings",
    description: "Manage plans, people, integrations, and automation controls"
  },
  {
    to: "/workflow-designer",
    label: "Workflow Designer",
    description: "Build, test, and launch automations from the canvas"
  }
];
