import { createContext, useContext } from 'react'
import type { MarkFilter, Marks, PersonalMark } from './personal-marks'

export const MarksContext = createContext<{
  marks: Marks
  error: boolean
  filter: MarkFilter
  setFilter: (filter: MarkFilter) => void
  toggle: (id: string, value: PersonalMark) => void
  includes: (id?: string) => boolean
} | null>(null)

export const usePersonalMarks = () => useContext(MarksContext)
