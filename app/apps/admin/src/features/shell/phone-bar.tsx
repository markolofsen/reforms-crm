import { BrandHeader } from "@hub/ui/product/brand-header";
import { ThemeToggle } from "@hub/ui/product/theme";
import type { Brand } from "./app-sidebar";
import { ProjectSwitcher } from "./project-switcher";

/** A phone's top line (hidden from 640px by CSS, where the sidebar carries the same): brand, the switcher with several projects, the theme toggle. */
export function PhoneBar({ brand, projects, project, onProject }: { brand: Brand; projects: string[]; project: string | null; onProject: (p: string) => void }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 border-b pe-2 md:hidden" data-testid="phone-bar">
      <BrandHeader className="flex-1" logoSrc={brand.logoSrc} name={brand.name} />
      {/* The switcher may take under half of 360px, so the brand name keeps its start. */}
      {project && projects.length > 1 && (
        <div className="min-w-0 max-w-[45%]">
          <ProjectSwitcher onChange={onProject} projects={projects} value={project} />
        </div>
      )}
      <ThemeToggle />
    </div>
  );
}
