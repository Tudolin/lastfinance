export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-4">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-[18px] bg-surface-2" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-[18px] bg-surface-2" />
    </div>
  );
}
