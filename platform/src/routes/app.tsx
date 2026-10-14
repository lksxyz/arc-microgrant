import { createFileRoute, Link, Navigate, Outlet } from '@tanstack/react-router'
import { usePrivy } from '@privy-io/react-auth'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/app')({
  component: AppLayout,
})

const navItems = [
  { to: '/app', label: 'Dashboard' },
  { to: '/app/service', label: 'Service' },
  { to: '/app/booking', label: 'Booking' },
  { to: '/app/setting', label: 'Setting' },
] as const

function AppLayout() {
  const { ready, authenticated, logout } = usePrivy()

  if (!ready) {
    return (
      <div className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-3 p-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (!authenticated) return <Navigate to="/login" />

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col md:max-w-xl">
      <header className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background px-4 py-3">
        <div className="flex items-center justify-between">
          <Link to="/app" className="flex items-center gap-2 text-4xl font-semibold tracking-tight text-red">
            <img src="/android-icon-96x96.png" alt="" width={24} height={24} />
            Intensio
          </Link>
          <Button variant="ghost" size="sm" onClick={() => logout()}>
            Log out
          </Button>
        </div>
        <nav className="flex gap-1 overflow-x-auto">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === '/app' }}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted data-[status=active]:bg-muted data-[status=active]:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex flex-col gap-4 p-4">
        <Outlet />
      </main>
    </div>
  )
}
