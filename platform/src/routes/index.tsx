import { createFileRoute, Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/')({
  component: Landing,
})

const steps = [
  { title: 'Sign up with email, Google, or wallet', body: 'Log in once and your account is ready to use.' },
  { title: 'Fill in your business profile', body: 'Your business name, tagline, and short description.' },
  { title: 'Create a service', body: 'Set the duration, price, schedule, and USDC deposit amount.' },
  { title: 'Share your booking link', body: 'Customers book through your link and must pay a deposit on Arc.' },
]

function Landing() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-16 px-4 py-10 md:max-w-xl">
      <section className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <img src="/android-icon-48x48.png" alt="" width={28} height={28} className="dark:invert" />
          <p className="text-4xl font-medium text-black">Intensio</p>
        </div>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight">
          Bookings with USDC deposits on Arc.
        </h1>
        <p className="text-base text-muted-foreground">
          A booking system for businesses with schedules. Customers must deposit USDC before the slot
          is locked.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" className="h-12 px-6 text-base" render={<Link to="/login" />}>
            Get started
          </Button>
          <Button size="lg" variant="secondary" className="h-12 px-6 text-base" render={<Link to="/my-bookings" />}>
            View my bookings
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="flex flex-col gap-3">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {i + 1}. {s.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{s.body}</CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
