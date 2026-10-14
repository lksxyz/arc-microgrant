import { createFileRoute, Navigate } from '@tanstack/react-router'
import { usePrivy } from '@privy-io/react-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/login')({
  component: Login,
})

function Login() {
  const { ready, authenticated, login } = usePrivy()

  if (ready && authenticated) return <Navigate to="/app" />

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <CardHeader>
          <img src="/android-icon-72x72.png" alt="Intensio" width={36} height={36} className="mb-2 dark:invert" />
          <CardTitle>Log in to Intensio</CardTitle>
          <CardDescription>Use email, Google, or wallet.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!ready ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Button size="lg" onClick={() => login()}>
              Continue to log in
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
