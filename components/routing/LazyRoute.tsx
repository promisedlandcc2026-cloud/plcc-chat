import React, { Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { LazyChunkErrorBoundary } from './LazyChunkErrorBoundary.jsx';

/** Lightweight branded fallback for lazy route chunks — must not import feature pages. */
export const RouteSectionFallback = ({ label = 'Loading this section…' }) => (
  <div
    className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-24 min-h-[50vh]"
    role="status"
    aria-live="polite"
  >
    <Loader2 className="animate-spin text-burgundy" size={32} aria-hidden />
    <p className="text-sm text-gray-500 text-center">{label}</p>
  </div>
);

/** Suspense + error boundary wrapper for route-level code splitting. */
export const LazyRoute = ({ children, label, sectionLabel }) => (
  <LazyChunkErrorBoundary sectionLabel={sectionLabel}>
    <Suspense fallback={<RouteSectionFallback label={label} />}>{children}</Suspense>
  </LazyChunkErrorBoundary>
);

export { LazyChunkErrorBoundary };
