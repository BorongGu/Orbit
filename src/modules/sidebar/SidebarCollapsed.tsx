import { Settings, AlertTriangle, Users, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { OrbitMark } from '@/shared/ui';

type SidebarCollapsedProps = {
  onExpand: () => void;
  onShowSettings: () => void;
  restartRequired: boolean;
  t: TFunction;
};

/** Rendered by Sidebar instead of SidebarContent when the panel is collapsed to its icon rail. */
export default function SidebarCollapsed({
  onExpand,
  onShowSettings,
  restartRequired,
  t,
}: SidebarCollapsedProps) {
  return (
    <div data-sidebar-rail className="flex h-full w-12 flex-col items-center gap-1 bg-background/80 py-3 backdrop-blur-sm">
      {/* Expand button with brand logo */}
      <button
        onClick={onExpand}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
        title={t('common:versionUpdate.ariaLabels.showSidebar')}
      >
        <OrbitMark className="h-7 w-7 text-primary" />
      </button>

      <div className="nav-divider my-1 w-6" />
      <Link to="/groups" aria-label="Groups" title="Groups" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/80 hover:text-foreground"><Users className="h-4 w-4" /></Link>
      <Link to="/notes" aria-label="笔记" title="笔记" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/80 hover:text-foreground"><BookOpen className="h-4 w-4" /></Link>

      {/* Settings */}
      <button
        onClick={onShowSettings}
        className="group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
        aria-label={t('actions.settings')}
        title={t('actions.settings')}
      >
        <Settings className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>

      {/* Restart-required indicator */}
      {restartRequired && (
        <div
          className="relative flex h-8 w-8 items-center justify-center rounded-lg"
          aria-label={t('version.restartRequired')}
          title={t('version.restartRequired')}
        >
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        </div>
      )}

    </div>
  );
}
