// El marco de las pantallas de acceso (entrar y crear la passkey): terciopelo, filete dorado y la
// marca de la clínica.
export function Marco({ titulo, children }) {
  return (
    <main className="terciopelo min-h-full grid place-items-center px-4 py-10">
      <section aria-labelledby="titulo-acceso"
        className="relative z-10 w-full max-w-sm rounded-2xl border filete bg-terciopelo-950/60 p-8 text-white shadow-[0_30px_80px_-30px_rgba(0,0,0,.7)] backdrop-blur">
        <div className="marca text-center text-3xl text-turquesa" aria-hidden="true">IEMEC</div>
        <h1 id="titulo-acceso" className="titulo mt-3 text-center text-2xl text-white/90"><span className="sr-only">IEMEC · </span>{titulo}</h1>
        <div aria-hidden="true" className="mx-auto mt-4 h-px w-20" style={{ background: 'linear-gradient(90deg, transparent, var(--color-oro), transparent)' }} />
        {children}
      </section>
    </main>
  );
}

// Una persona con su llave: el dibujo de las passkeys.
export function IconoPasskey({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3.5 19.5c0-3 2.5-5.2 5.5-5.2 1.4 0 2.6.4 3.6 1.1" />
      <circle cx="17.5" cy="12.5" r="2.3" />
      <path d="M17.5 14.8v5.2l1.5-1.3M17.5 17.6h1.5" />
    </svg>
  );
}
