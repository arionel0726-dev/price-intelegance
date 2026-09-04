'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { login } from '@/features/auth/api/login'

export default function LoginPage() {
	const router = useRouter()

	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [isSubmitting, setIsSubmitting] = useState(false)

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault()

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
							type="email"
							autoComplete="email"
							value={email}
							onChange={event => setEmail(event.target.value)}
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
							type="password"
							autoComplete="current-password"
							value={password}
							onChange={event => setPassword(event.target.value)}
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
