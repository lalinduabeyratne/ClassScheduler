"use client";

import {
  type DocumentData,
  type Query,
  type QuerySnapshot,
  onSnapshot,
} from "firebase/firestore";
import { useEffect, useState } from "react";

export function useFirestoreQuery<T = DocumentData>(q: Query<T> | null) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!q) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      q as unknown as Query<DocumentData>,
      (snap: QuerySnapshot<DocumentData>) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T));
        setLoading(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : "Firestore error");
        setLoading(false);
      },
    );
    return () => unsub();
  }, [q]);

  return { data, loading, error };
}

