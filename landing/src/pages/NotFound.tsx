import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-medium uppercase tracking-[0.16em] text-muted">404</p>
      <h1 className="text-2xl font-semibold text-ink">This page has moved or never existed</h1>
      <p className="leading-relaxed text-muted">
        The link may be out of date. Head back to the homepage to find what you need.
      </p>
      <Link
        to="/"
        className="mt-2 inline-flex items-center justify-center rounded-pill bg-ink px-6 py-3 text-sm font-medium text-white transition-transform duration-[600ms] ease-hims-expo hover:scale-[1.03]"
      >
        Back to home
      </Link>
    </div>
  );
}
