export async function createAuthUserWithEmailPassword(args: {
  email: string;
  password: string;
}): Promise<{ uid: string }> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing NEXT_PUBLIC_FIREBASE_API_KEY.");
  }

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: args.email.trim(),
        password: args.password,
        returnSecureToken: false,
      }),
    },
  );

  const payload = (await res.json()) as {
    localId?: string;
    error?: { message?: string };
  };

  if (!res.ok || !payload.localId) {
    const msg = payload.error?.message ?? "Failed to create Firebase Auth user.";
    throw new Error(msg);
  }

  return { uid: payload.localId };
}
