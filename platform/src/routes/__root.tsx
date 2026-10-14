import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-svh bg-background text-foreground">
      <Outlet />
    </div>
  ),
})
