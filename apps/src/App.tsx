
function App() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="flex items-center justify-between border-b border-slate-200 px-6 py-5 md:px-12">
        <a href="/" className="flex items-center gap-3 text-2xl font-bold tracking-tight">
          <span className="grid size-10 place-items-center rounded-xl bg-indigo-700 text-white">
            A
          </span>
          acadlas
        </a>

        <span className="text-xs font-bold tracking-widest text-slate-500">
          DEVELOPMENT PREVIEW
        </span>
      </nav>

      <section className="mx-auto max-w-6xl px-6 py-24 md:px-12 md:py-32">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
          <span className="size-2 rounded-full bg-indigo-600" />
          A new ecosystem is taking shape
        </div>

        <h1 className="mt-8 text-5xl font-bold leading-tight tracking-tight sm:text-6xl lg:text-7xl">
          One platform.
          <br />
          <span className="text-indigo-700">Endless possibilities.</span>
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 md:text-xl">
          A connected ecosystem of software built for educational
          institutions and the people who power them.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-5">
          <button
            type="button"
            onClick={() => alert('Welcome to Acadlas!')}
            className="rounded-xl bg-indigo-700 px-6 py-4 font-semibold text-white transition hover:bg-indigo-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700"
          >
            Explore Acadlas <span aria-hidden="true">→</span>
          </button>

          <span className="text-sm text-slate-500">
            Built step by step, from the ground up.
          </span>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white px-6 py-20 md:px-12">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-bold tracking-[0.2em] text-indigo-700">
            THE BIGGER PICTURE
          </p>

          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            A shared foundation. Independent products.
          </h2>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                letter: 'S',
                name: 'School',
                description: 'Purpose-built school operations.',
              },
              {
                letter: 'C',
                name: 'CRM',
                description: 'Enquiries, relationships and follow-ups.',
              },
              {
                letter: 'B',
                name: 'Billing',
                description: 'Independent billing and financial workflows.',
              },
            ].map((product) => (
              <article
                key={product.name}
                className="rounded-2xl border border-slate-200 p-7 transition hover:border-indigo-300 hover:shadow-lg hover:shadow-slate-200/50"
              >
                <span className="grid size-11 place-items-center rounded-xl bg-indigo-50 font-bold text-indigo-700">
                  {product.letter}
                </span>

                <h3 className="mt-6 text-xl font-semibold">
                  Acadlas {product.name}
                </h3>

                <p className="mt-2 leading-6 text-slate-600">
                  {product.description}
                </p>

                <span className="mt-6 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  Planned
                </span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="flex flex-col gap-3 border-t border-slate-200 px-6 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between md:px-12">
        <span>Acadlas © 2026</span>
        <span>Our journey starts here.</span>
      </footer>
    </main>
  )
}

export default App
