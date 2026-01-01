import WorkspaceShell from "./workspace/WorkspaceShell";

type ThemeMode = "dark" | "light";

export default function IDEFragment({ theme = "dark", isActive = false }: { theme?: ThemeMode; isActive?: boolean }) {
  return <WorkspaceShell variant="ide" theme={theme} isActive={isActive} />;
}

