export function StarRow({ count, total = 3, size = 28 }: { count: number; total?: number; size?: number }) {
  return (
    <span className="inline-flex gap-1" aria-label={`${count} 颗星`} style={{ fontSize: size, lineHeight: 1 }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} aria-hidden style={{ filter: i < count ? undefined : 'grayscale(1)', opacity: i < count ? 1 : 0.35 }}>
          ⭐
        </span>
      ))}
    </span>
  );
}
