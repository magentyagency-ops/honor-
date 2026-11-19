import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** Lee y escribe un parámetro de la URL (pestañas, filtros): el estado de la vista se puede compartir y recargar. */
export function useQuery<T extends string>(name: string, fallback: T): [T, (value: T | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = (params.get(name) as T | null) ?? fallback;
  const set = useCallback(
    (v: T | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === null || v === fallback) next.delete(name);
          else next.set(name, v);
          return next;
        },
        { replace: true },
      );
    },
    [name, fallback, setParams],
  );
  return [value, set];
}
