"use client";

import { useMemo } from "react";
import { qStudents } from "@/lib/firestore/api";
import { useFirestoreQuery } from "@/lib/firestore/hooks";

export type StudentLite = {
  id: string;
  fullName: string;
  active: boolean;
};

export function useStudentsMap(enabled: boolean) {
  const studentsQuery = useMemo(() => (enabled ? qStudents() : null), [enabled]);
  const { data: rawStudents, loading } = useFirestoreQuery<Record<string, unknown>>(
    studentsQuery,
  );

  const students = useMemo(() => {
    return rawStudents.map((s: any) => ({
      id: String(s.id),
      fullName: String(s.fullName ?? s.id),
      active: Boolean(s.active ?? true),
    })) as StudentLite[];
  }, [rawStudents]);

  const byId = useMemo(() => {
    const m = new Map<string, StudentLite>();
    for (const s of students) m.set(s.id, s);
    return m;
  }, [students]);

  return { students, byId, loading };
}

