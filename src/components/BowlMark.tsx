import { cn } from '@/lib/utils'

export function BowlMark({ className, steam = true }: { className?: string; steam?: boolean }) {
  return (
    <span className={cn('relative inline-flex items-center justify-center', className)}>
      {steam ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 -top-5 flex justify-center gap-2.5">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className="animate-steam h-7 w-0.5 rounded-full bg-gradient-to-t from-primary/55 via-primary/25 to-transparent blur-[1.5px]"
              style={{ animationDelay: `${index * 1.1}s` }}
            />
          ))}
        </span>
      ) : null}
      <svg viewBox="2 26 60 32" className="size-full" fill="none">
        <path
          d="M7 29h50c0 14.4-11.2 26-25 26S7 43.4 7 29Z"
          className="fill-primary/15 stroke-primary"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        <path d="M4 29h56" className="stroke-primary" strokeWidth="2.4" strokeLinecap="round" />
        <path
          d="M20 40c3 3 8 5 12 5s9-2 12-5"
          className="stroke-primary/60"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  )
}
