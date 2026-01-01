import WorkspaceShell from "./workspace/WorkspaceShell";

type ThemeMode = "dark" | "light";

export default function WaveletsWorkspaceFragment({
  theme = "dark",
  isActive = false,
}: {
  theme?: ThemeMode;
  isActive?: boolean;
}) {
  return <WorkspaceShell variant="wavelets" theme={theme} isActive={isActive} />;
}

