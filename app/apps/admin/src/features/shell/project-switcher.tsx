import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { useSidebar } from "@/components/ui/sidebar";
import { useProjectScope } from "@/hooks/use-project";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";

/**
 * The project, one menu. In the sidebar it is the first thing (an initial only in the rail); on a phone it sits at
 * the top of the Project screen. Choosing one replaces the address (a project is a place, not a step).
 */
export function ProjectSwitcher({ projects, value, onChange }: { projects: string[]; value: string; onChange: (project: string) => void }) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <ActionButton className="w-full justify-start gap-2 px-2 group-data-[collapsible=icon]:px-0" size="m" variant="quiet" />
        }
      >
        {/* The initial is generated content, so it is not part of the name or the visible text; the name span stays for assistive tech in the rail. */}
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-md bg-primary font-semibold text-primary-foreground text-xs before:content-[attr(data-initial)] group-data-[collapsible=icon]:mx-auto" data-initial={value.slice(0, 1).toUpperCase()} />
        <span className="min-w-0 flex-1 truncate text-start font-medium group-data-[collapsible=icon]:sr-only">{value}</span>
        <ChevronsUpDownIcon aria-hidden="true" className="group-data-[collapsible=icon]:hidden" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom">
        <MenuGroup>
          <MenuGroupLabel>Projects</MenuGroupLabel>
          {projects.map((p) => (
            <MenuItem key={p} onClick={() => onChange(p)}>
              {p === value ? <CheckIcon aria-hidden="true" /> : <span aria-hidden="true" className="size-4" />}
              {p}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/** On a phone the sidebar's switcher is not there: it heads each single-column screen instead. Null everywhere else. */
export function PhoneProjectSwitcher() {
  const { isMobile } = useSidebar();
  const { project, projects, onProject } = useProjectScope();
  return isMobile ? <div><ProjectSwitcher onChange={onProject} projects={projects} value={project} /></div> : null;
}
