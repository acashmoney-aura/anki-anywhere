import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const providers: any[] = [Password];

if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers,
});
