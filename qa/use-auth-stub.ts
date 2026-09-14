// QA-only stub — swapped in by vite.config.qa.ts for @/hooks/use-auth.
// The real hook hits Convex; the harness must render without a backend.
export function useAuth() {
  return {
    isLoading: false,
    isAuthenticated: true,
    user: { name: "QA Examiner" },
    signIn: async () => {},
    signOut: async () => {},
  };
}
