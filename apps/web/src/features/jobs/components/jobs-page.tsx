'use client'

import { Plus } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { ActiveJobsSection } from './active-jobs-section'
import { JobHistoryList } from './job-history-list'
import { NewJobForm } from './new-job-form'

export function JobsPage() {
	const [showForm, setShowForm] = useState(false)

	return (
		<div className="flex flex-col gap-10">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-3xl font-light tracking-tight text-text-primary">Discovery Jobs</h1>
					<p className="mt-1 text-sm text-text-muted">Run and monitor competitor price-discovery jobs.</p>
				</div>

				{!showForm && (
					<Button onClick={() => setShowForm(true)} className="gap-1.5 rounded bg-accent text-white hover:bg-accent/90">
						<Plus className="size-4" aria-hidden="true" />
						New job
					</Button>
				)}
			</div>

			{showForm && <NewJobForm onDone={() => setShowForm(false)} />}

			<section>
				<h2 className="mb-3 font-medium text-text-primary">Active</h2>
				<ActiveJobsSection />
			</section>

			<section>
				<JobHistoryList />
			</section>
		</div>
	)
}
