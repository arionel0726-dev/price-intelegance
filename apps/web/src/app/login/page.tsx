'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { login } from '@/features/auth/api/login'

export default function LoginPage() {
	const router = useRouter()

	const [error, setError] = useState<string | null>(null)
	const [isSubmitting, setIsSubmitting] = useState(false)

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()

		// Read the live DOM values via FormData instead of React state -
		// browser autofill/password managers (Firefox in particular) can set
		// an input's visible value without firing a React-observable change
		// event, leaving controlled state stuck at '' while the field shows
		// the filled-in value. FormData always reflects what's actually in
		// the form, regardless of how it got there.
		const formData = new FormData(event.currentTarget)
		const email = String(formData.get('email') ?? '')
		const password = String(formData.get('password') ?? '')

		setError(null)
		setIsSubmitting(true)

		try {
			await login(email, password)

			router.push('/')
			router.refresh()
		} catch {
			setError('Invalid email or password')
			setIsSubmitting(false)
		}
	}

	return (
		<div className="flex min-h-screen items-center justify-center bg-background px-5">
			<div className="w-full max-w-sm">
				<p className="text-center text-xl font-semibold tracking-tight">
					Price
				</p>

				<form
					onSubmit={handleSubmit}
					className="mt-8 flex flex-col gap-4"
				>
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="email"
							className="text-sm font-medium"
						>
							Email
						</label>

						<Input
							id="email"
							name="email"
							type="email"
							autoComplete="email"
							required
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="password"
							className="text-sm font-medium"
						>
							Password
						</label>

						<Input
							id="password"
							name="password"
							type="password"
							autoComplete="current-password"
							required
						/>
					</div>

					{error && <p className="text-sm text-destructive">{error}</p>}

					<Button
						type="submit"
						disabled={isSubmitting}
						className="mt-2 rounded-full"
					>
						{isSubmitting ? 'Signing in...' : 'Sign in'}
					</Button>
				</form>
			</div>
		</div>
	)
}
