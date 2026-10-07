export function PrivacyNote({ className = '' }: { className?: string }) {
  return (
    <p className={`border-[3px] border-ink bg-paper p-3 text-xs font-black uppercase leading-snug sm:text-sm ${className}`}>
      YOUR CAMERA STAYS IN YOUR BROWSER AND CONNECTS DIRECTLY TO YOUR PARTNER WHEN POSSIBLE. PHOTOS ARE PROCESSED
      LOCALLY UNLESS YOU CHOOSE TO SAVE OR SHARE THEM.
    </p>
  )
}
