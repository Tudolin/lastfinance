export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm font-semibold text-danger-ink">
      {message}
    </p>
  );
}
