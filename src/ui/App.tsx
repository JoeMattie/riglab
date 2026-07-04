import { useEffect } from 'react';
import { useAppStore } from '../state/appStore';
import { EditorShell } from './EditorShell';
import { ProjectList } from './ProjectList';

export function App() {
  const current = useAppStore((s) => s.current);
  const refreshProjects = useAppStore((s) => s.refreshProjects);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  return current ? <EditorShell /> : <ProjectList />;
}
