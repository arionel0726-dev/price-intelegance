/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'

import { optionToTriState, reasonRequired, triStateToOption } from './tri-state'

describe('triStateToOption / optionToTriState', () => {
	test('true <-> enabled', () => {
		expect(triStateToOption(true)).toBe('enabled')
		expect(optionToTriState('enabled')).toBe(true)
	})

	test('false <-> disabled', () => {
		expect(triStateToOption(false)).toBe('disabled')
		expect(optionToTriState('disabled')).toBe(false)
	})

	test('null <-> inherit', () => {
		expect(triStateToOption(null)).toBe('inherit')
		expect(optionToTriState('inherit')).toBeNull()
	})
})

describe('reasonRequired', () => {
	test('a reason is required ONLY for force-disable', () => {
		expect(reasonRequired('disabled')).toBe(true)
	})

	test('force-enable never requires a reason', () => {
		expect(reasonRequired('enabled')).toBe(false)
	})

	test('returning to inherit never requires a reason', () => {
		expect(reasonRequired('inherit')).toBe(false)
	})
})
