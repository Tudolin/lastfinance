import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-extrabold">Página não encontrada</h1>
      <Link href="/" className="font-bold">
        Voltar ao painel
      </Link>
    </main>
  );
}
